#!/usr/bin/env python3
"""Refresh taxonomy JSON assets from the Neotoma API.

Outputs:
  - data/taxon_names.json
  - data/taxon_paths_ids.json
  - data/taxagroup_names.json
  - data/all_synonyms.json
  - data/taxon_metadata.json
  - data/taxa_changes.json
  - data/taxa_snapshot.json

This script is designed to run in GitHub Actions without third-party
dependencies. It fetches the core taxonomy tables, normalizes them into the
formats expected by the current frontend, and computes a lightweight summary of
new and modified taxa since the previous snapshot.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from http.client import IncompleteRead


DEFAULT_API_BASE = "https://api.neotomadb.org/v2.0"
DEFAULT_PAGE_SIZE = 5000
MAX_FETCH_RETRIES = 3
PUBLICATION_FETCH_WORKERS = 12
WATCH_FIELDS = (
    "taxonname",
    "highertaxonid",
    "taxagroupid",
    "recdatecreated",
    "recdatemodified",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--output-dir", default="data")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--changes-file", default="data/taxa_changes.json")
    parser.add_argument("--snapshot-file", default="data/taxa_snapshot.json")
    parser.add_argument("--lookback-days", type=int, default=30)
    parser.add_argument("--summary-since", default=None, help="YYYY-MM-DD lower bound for steward summary items")
    return parser.parse_args()


def log(message: str) -> None:
    print(f"[refresh_taxonomy] {message}", file=sys.stderr)


def fetch_json(url: str) -> Any:
    last_error: Exception | None = None
    for attempt in range(1, MAX_FETCH_RETRIES + 1):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Neotoma-Visualizer-Refresh/1.0",
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                return json.load(response)
        except HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code} while fetching {url}") from exc
        except (URLError, IncompleteRead, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == MAX_FETCH_RETRIES:
                break
            log(f"Retrying fetch ({attempt}/{MAX_FETCH_RETRIES}) for {url} after error: {exc}")
    raise RuntimeError(f"Network error while fetching {url}: {last_error}") from last_error


def extract_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        if isinstance(payload.get("data"), list):
            return [row for row in payload["data"] if isinstance(row, dict)]
        list_values = [value for value in payload.values() if isinstance(value, list)]
        if len(list_values) == 1:
            return [row for row in list_values[0] if isinstance(row, dict)]
    raise RuntimeError("Unexpected API payload shape; could not extract rows.")


def fetch_table(api_base: str, table: str, page_size: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0

    while True:
        query = urlencode({"count": "false", "limit": page_size, "offset": offset})
        url = f"{api_base}/data/dbtables/{table}?{query}"
        page = extract_rows(fetch_json(url))
        if not page:
            break
        rows.extend(page)
        log(f"Fetched {len(page)} rows from {table} (total {len(rows)})")
        if len(page) < page_size:
            break
        offset += len(page)

    return rows


def fetch_publications_by_id(api_base: str, publication_ids: set[int]) -> dict[int, dict[str, Any]]:
    if not publication_ids:
        return {}

    def fetch_one(publication_id: int) -> tuple[int, dict[str, Any] | None]:
        query = urlencode({"publicationid": publication_id})
        url = f"{api_base}/data/publications?{query}"
        payload = fetch_json(url)
        result_rows = payload.get("data", {}).get("result", []) if isinstance(payload, dict) else []
        if not result_rows:
            return publication_id, None
        publication = first_present(result_rows[0], "publication")
        if not isinstance(publication, dict):
            return publication_id, None
        return publication_id, publication

    publications_by_id: dict[int, dict[str, Any]] = {}
    total = len(publication_ids)
    completed = 0
    with ThreadPoolExecutor(max_workers=PUBLICATION_FETCH_WORKERS) as executor:
        future_map = {
            executor.submit(fetch_one, publication_id): publication_id
            for publication_id in sorted(publication_ids)
        }
        for future in as_completed(future_map):
            publication_id, publication = future.result()
            completed += 1
            if publication is not None:
                publications_by_id[publication_id] = publication
            if completed == total or completed % 250 == 0:
                log(f"Fetched {completed}/{total} publication details")

    return publications_by_id


def to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def parse_summary_since(value: str | None) -> datetime | None:
    if not value:
        return None
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def first_present(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            return row[key]
    return None


def build_taxonpaths_from_taxa(taxa_rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    taxa_by_id: dict[int, dict[str, Any]] = {}
    for row in taxa_rows:
        taxon_id = to_int(first_present(row, "taxonid"))
        if taxon_id is None:
            continue
        taxa_by_id[taxon_id] = {
            "taxonid": taxon_id,
            "taxonname": str(first_present(row, "taxonname", "name") or taxon_id),
            "highertaxonid": to_int(first_present(row, "highertaxonid")),
            "taxagroupid": str(first_present(row, "taxagroupid", "taxagroup") or ""),
        }

    cache: dict[int, tuple[list[int], list[str]]] = {}

    def resolve_path(taxon_id: int, stack: set[int] | None = None) -> tuple[list[int], list[str]]:
        if taxon_id in cache:
            return cache[taxon_id]

        row = taxa_by_id.get(taxon_id)
        if not row:
            cache[taxon_id] = ([taxon_id], [str(taxon_id)])
            return cache[taxon_id]

        if stack is None:
            stack = set()
        if taxon_id in stack:
            cache[taxon_id] = ([taxon_id], [row["taxonname"]])
            return cache[taxon_id]

        stack = set(stack)
        stack.add(taxon_id)

        parent_id = row["highertaxonid"]
        if parent_id is None or parent_id == taxon_id or parent_id not in taxa_by_id:
            result = ([taxon_id], [row["taxonname"]])
        else:
            parent_ids, parent_names = resolve_path(parent_id, stack)
            result = (parent_ids + [taxon_id], parent_names + [row["taxonname"]])

        cache[taxon_id] = result
        return result

    normalized: list[dict[str, Any]] = []
    for taxon_id, row in taxa_by_id.items():
        path_ids, path_names = resolve_path(taxon_id)
        normalized.append(
            {
                "taxonid": taxon_id,
                "taxonname": row["taxonname"],
                "path_ids": path_ids,
                "path_names": path_names,
                "taxagroupid": row["taxagroupid"],
            }
        )

    normalized.sort(key=lambda row: (row["taxagroupid"], row["taxonname"].lower(), row["taxonid"]))
    return {"taxonpaths": normalized}


def build_split_taxonomy(
    taxonpaths_payload: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, str], dict[str, Any]]:
    """Build compact, ID-first browser payloads from structured path data."""
    rows = next(iter(taxonpaths_payload.values()), [])
    names = {
        str(row["taxonid"]): row["taxonname"].strip()
        for row in sorted(rows, key=lambda item: int(item["taxonid"]))
    }
    paths = [
        [
            row["taxagroupid"],
            [int(part) for part in row.get("path_ids", [])],
        ]
        for row in rows
    ]
    return names, {"schema_version": 1, "paths": paths}


def build_taxagroup_names(rows: list[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for row in rows:
        group_id = first_present(row, "taxagroupid", "taxagrouptypeid")
        name = first_present(row, "taxagroup", "taxagrouptype", "taxagroupname", "name")
        if group_id and name:
            result[str(group_id)] = str(name)
    return dict(sorted(result.items()))


def build_synonyms(
    taxa_rows: list[dict[str, Any]],
    synonym_rows: list[dict[str, Any]],
    synonym_type_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    taxa_by_id: dict[int, dict[str, Any]] = {}
    for row in taxa_rows:
        taxon_id = to_int(first_present(row, "taxonid"))
        if taxon_id is None:
            continue
        taxa_by_id[taxon_id] = {
            "taxonname": str(first_present(row, "taxonname", "name") or taxon_id),
            "taxagroupid": str(first_present(row, "taxagroupid", "taxagroup") or ""),
        }

    synonym_types: dict[int, str] = {}
    for row in synonym_type_rows:
        synonym_type_id = to_int(first_present(row, "synonymtypeid"))
        synonym_type_name = first_present(
            row,
            "synonymtype",
            "synonymtypename",
            "synonymtypedesc",
            "description",
            "name",
        )
        if synonym_type_id is not None and synonym_type_name:
            synonym_types[synonym_type_id] = str(synonym_type_name)

    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in synonym_rows:
        valid_id = to_int(first_present(row, "validtaxonid", "taxonid"))
        invalid_id = to_int(first_present(row, "invalidtaxonid", "synonymid"))
        invalid_name = None
        if invalid_id is not None:
            invalid_name = taxa_by_id.get(invalid_id, {}).get("taxonname")
        if not invalid_name:
            invalid_name = first_present(row, "synonymname", "name")
        if valid_id is None or invalid_id is None or not invalid_name:
            continue
        synonym_type_id = to_int(first_present(row, "synonymtypeid"))
        grouped[valid_id].append(
            {
                "invalid_id": invalid_id,
                "invalid_name": str(invalid_name),
                "synonymtypeid": synonym_type_id,
                "synonymtype": synonym_types.get(synonym_type_id or -1, ""),
                "recdatecreated": first_present(row, "recdatecreated"),
                "recdatemodified": first_present(row, "recdatemodified"),
            }
        )

    results: list[dict[str, Any]] = []
    for valid_id, synonyms in grouped.items():
        valid_info = taxa_by_id.get(valid_id)
        if not valid_info:
            continue
        synonyms.sort(key=lambda item: (item["invalid_name"].lower(), item["invalid_id"]))
        results.append(
            {
                "valid_id": valid_id,
                "valid_name": valid_info["taxonname"],
                "taxagroupid": valid_info["taxagroupid"],
                "synonyms": synonyms,
            }
        )

    results.sort(key=lambda item: (item["taxagroupid"], item["valid_name"].lower(), item["valid_id"]))
    return results


def build_snapshot(taxa_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    snapshot: dict[str, dict[str, Any]] = {}
    for row in taxa_rows:
        taxon_id = to_int(first_present(row, "taxonid"))
        if taxon_id is None:
            continue
        snapshot[str(taxon_id)] = {
            "taxonid": taxon_id,
            "taxonname": str(first_present(row, "taxonname", "name") or taxon_id),
            "highertaxonid": to_int(first_present(row, "highertaxonid")),
            "taxagroupid": str(first_present(row, "taxagroupid", "taxagroup") or ""),
            "recdatecreated": first_present(row, "recdatecreated"),
            "recdatemodified": first_present(row, "recdatemodified"),
        }
    return snapshot


def format_contact_name(contact: dict[str, Any] | None) -> str | None:
    if not contact:
        return None
    contact_name = first_present(contact, "contactname")
    if contact_name:
        return str(contact_name).strip()
    parts = [first_present(contact, "givennames"), first_present(contact, "familyname")]
    joined = " ".join(str(part).strip() for part in parts if part)
    return joined or None


def build_taxon_metadata(
    taxa_rows: list[dict[str, Any]],
    contacts_rows: list[dict[str, Any]],
    publications_by_id: dict[int, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    contacts_by_id: dict[int, dict[str, Any]] = {}
    for row in contacts_rows:
        contact_id = to_int(first_present(row, "contactid"))
        if contact_id is None:
            continue
        contacts_by_id[contact_id] = row

    metadata: dict[str, dict[str, Any]] = {}
    for row in taxa_rows:
        taxon_id = to_int(first_present(row, "taxonid"))
        if taxon_id is None:
            continue
        validator_id = to_int(first_present(row, "validatorid"))
        contact = contacts_by_id.get(validator_id) if validator_id is not None else None
        publication_id = to_int(first_present(row, "publicationid"))
        publication = publications_by_id.get(publication_id) if publication_id is not None else None
        metadata[str(taxon_id)] = {
            "taxonid": taxon_id,
            "author": first_present(row, "author"),
            "publicationid": publication_id,
            "publication": first_present(publication or {}, "citation") or first_present(row, "publication"),
            "citation": first_present(publication or {}, "citation"),
            "publicationYear": first_present(publication or {}, "year"),
            "validatorid": validator_id,
            "validatorName": format_contact_name(contact),
            "validatedate": first_present(row, "validatedate"),
        }
    return metadata


def load_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_path_lookup(taxonpaths_payload: dict[str, list[dict[str, Any]]]) -> dict[int, dict[str, Any]]:
    rows = next(iter(taxonpaths_payload.values()), [])
    lookup: dict[int, dict[str, Any]] = {}
    for row in rows:
        lookup[int(row["taxonid"])] = {
            "path_ids": [int(part) for part in row.get("path_ids", [])],
            "path_names": [str(part).strip() for part in row.get("path_names", [])],
            "taxagroupid": row["taxagroupid"],
            "taxonname": row["taxonname"],
        }
    return lookup


def build_changes(
    previous_snapshot_data: dict[str, Any],
    current_snapshot: dict[str, dict[str, Any]],
    path_lookup: dict[int, dict[str, Any]],
    summary_since: datetime | None = None,
    lookback_days: int = 30,
) -> dict[str, Any]:
    new_items: list[dict[str, Any]] = []
    modified_items: list[dict[str, Any]] = []

    generated_at = datetime.now(timezone.utc).replace(microsecond=0)
    if summary_since is None:
        summary_since = generated_at.replace() - timedelta(days=lookback_days)

    for taxon_id, current in current_snapshot.items():
        path_info = path_lookup.get(int(taxon_id), {})
        created_at = parse_timestamp(current.get("recdatecreated"))
        modified_at = parse_timestamp(current.get("recdatemodified"))

        if created_at is not None and created_at >= summary_since:
            new_items.append(
                {
                    **current,
                    "path_ids": path_info.get("path_ids", []),
                    "path_names": path_info.get("path_names", []),
                }
            )
            continue

        if modified_at is not None and modified_at >= summary_since:
            modified_items.append(
                {
                    **current,
                    "changed_fields": ["recdatemodified"],
                    "previous": {},
                    "path_ids": path_info.get("path_ids", []),
                    "path_names": path_info.get("path_names", []),
                }
            )

    new_items.sort(key=lambda item: (item["taxagroupid"], item["taxonname"].lower(), item["taxonid"]))
    modified_items.sort(key=lambda item: (item["taxagroupid"], item["taxonname"].lower(), item["taxonid"]))
    return {
        "generated_at": generated_at.isoformat(),
        "since": summary_since.date().isoformat(),
        "counts": {
            "new": len(new_items),
            "modified": len(modified_items),
            "total": len(new_items) + len(modified_items),
        },
        "new": new_items,
        "modified": modified_items,
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def write_compact_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    changes_file = Path(args.changes_file)
    snapshot_file = Path(args.snapshot_file)
    metadata_file = output_dir / "taxon_metadata.json"

    taxa_rows = fetch_table(args.api_base, "taxa", args.page_size)
    taxagroup_rows = fetch_table(args.api_base, "taxagrouptypes", args.page_size)
    synonym_rows = fetch_table(args.api_base, "synonyms", args.page_size)
    synonym_type_rows = fetch_table(args.api_base, "synonymtypes", args.page_size)
    contacts_rows = fetch_table(args.api_base, "contacts", args.page_size)
    publication_ids = {
        publication_id
        for row in taxa_rows
        for publication_id in [to_int(first_present(row, "publicationid"))]
        if publication_id is not None
    }
    publications_by_id = fetch_publications_by_id(args.api_base, publication_ids)

    normalized_taxonpaths = build_taxonpaths_from_taxa(taxa_rows)
    taxon_names, taxon_paths_ids = build_split_taxonomy(normalized_taxonpaths)
    taxagroup_names = build_taxagroup_names(taxagroup_rows)
    synonyms_payload = build_synonyms(taxa_rows, synonym_rows, synonym_type_rows)
    taxon_metadata = build_taxon_metadata(taxa_rows, contacts_rows, publications_by_id)

    previous_snapshot = load_json_file(snapshot_file, default={})
    current_snapshot = build_snapshot(taxa_rows)
    path_lookup = build_path_lookup(normalized_taxonpaths)
    changes_payload = build_changes(
        previous_snapshot,
        current_snapshot,
        path_lookup,
        summary_since=parse_summary_since(args.summary_since),
        lookback_days=args.lookback_days,
    )

    snapshot_payload = {
        "generated_at": changes_payload["generated_at"],
        "taxa": current_snapshot,
    }

    write_compact_json(output_dir / "taxon_names.json", taxon_names)
    write_compact_json(output_dir / "taxon_paths_ids.json", taxon_paths_ids)
    write_json(output_dir / "taxagroup_names.json", taxagroup_names)
    write_json(output_dir / "all_synonyms.json", synonyms_payload)
    write_json(metadata_file, taxon_metadata)
    write_json(changes_file, changes_payload)
    write_json(snapshot_file, snapshot_payload)

    log(
        "Wrote taxon_names.json, taxon_paths_ids.json, "
        "taxagroup_names.json, all_synonyms.json, "
        f"{metadata_file.name}, {changes_file.name}, and {snapshot_file.name}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
