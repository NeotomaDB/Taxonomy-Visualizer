#!/usr/bin/env python3
"""Enhance terminal-node files with occurrence counts and dataset IDs.

This script reads compact terminal-node JSON files and writes compact
occurrence/dataset summaries. In directory mode it processes one group file at
a time and writes each output immediately, so partial progress is preserved.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from http.client import IncompleteRead, RemoteDisconnected
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DEFAULT_API_BASE = "https://api.neotomadb.org/v2.0"
DEFAULT_PAGE_SIZE = 5000
MAX_FETCH_RETRIES = 8
RETRYABLE_HTTP_STATUS = {429, 500, 502, 503, 504}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--terminal-nodes-file", default="data/terminal_nodes/ACR_Acritarchs.json")
    parser.add_argument(
        "--terminal-nodes-dir",
        default=None,
        help="Directory of terminal-node JSON files. When set, processes groups one by one.",
    )
    parser.add_argument("--output-dir", default="data/terminal_nodes_datasetids")
    parser.add_argument("--output-file", default=None)
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument(
        "--groups",
        default="",
        help="Optional comma-separated taxagroupids to process in directory mode, e.g. ALG,MAM.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate outputs even when the target group JSON already exists.",
    )
    parser.add_argument(
        "--resume-after-index",
        type=int,
        default=0,
        help=(
            "Skip terminal taxonids through this 1-based index when resuming a single group. "
            "Use with --groups for directory mode."
        ),
    )
    parser.add_argument(
        "--skip-fetch-errors",
        action="store_true",
        help="Record repeatedly failing taxonids in failed_taxonids and continue.",
    )
    return parser.parse_args()


def log(message: str) -> None:
    print(f"[generate_terminal_node_occurrences] {message}", file=sys.stderr)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")


def to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_json(url: str) -> Any:
    last_error: Exception | None = None
    for attempt in range(1, MAX_FETCH_RETRIES + 1):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "Neotoma-Visualizer-Terminal-Occurrences/1.0",
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                return json.load(response)
        except HTTPError as exc:
            last_error = exc
            if exc.code not in RETRYABLE_HTTP_STATUS or attempt == MAX_FETCH_RETRIES:
                raise RuntimeError(f"HTTP {exc.code} while fetching {url}") from exc
            log(f"Retrying fetch ({attempt}/{MAX_FETCH_RETRIES}) for {url} after HTTP {exc.code}")
            time.sleep(attempt * 2)
        except (URLError, IncompleteRead, RemoteDisconnected, TimeoutError, ConnectionResetError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt == MAX_FETCH_RETRIES:
                break
            log(f"Retrying fetch ({attempt}/{MAX_FETCH_RETRIES}) for {url} after error: {exc}")
            time.sleep(attempt * 2)
    raise RuntimeError(f"Network error while fetching {url}: {last_error}") from last_error


def extract_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("data"), list):
        return [row for row in payload["data"] if isinstance(row, dict)]
    raise RuntimeError("Unexpected API payload shape; could not extract occurrence rows.")


def extract_occurrence_parts(row: dict[str, Any]) -> tuple[int | None, int | None, int | None]:
    site = row.get("site") if isinstance(row.get("site"), dict) else {}
    occid = to_int(row.get("occid") or row.get("occurrenceid"))
    siteid = to_int(row.get("siteid") or site.get("siteid"))
    datasetid = to_int(row.get("datasetid") or site.get("datasetid"))
    return occid, siteid, datasetid


def summarize_occurrence_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    occids: set[int] = set()
    siteids: set[int] = set()
    datasetids: set[int] = set()

    for row in rows:
        occid, siteid, datasetid = extract_occurrence_parts(row)
        if occid is not None:
            occids.add(occid)
        if siteid is not None:
            siteids.add(siteid)
        if datasetid is not None:
            datasetids.add(datasetid)

    sorted_datasetids = sorted(datasetids)
    return {
        "occurrenceCount": len(occids),
        "siteCount": len(siteids),
        "datasetids": sorted_datasetids,
    }


def fetch_occurrences_for_taxon(api_base: str, taxonid: int, page_size: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0

    while True:
        query = urlencode({"taxonid": taxonid, "limit": page_size, "offset": offset})
        url = f"{api_base}/data/occurrences?{query}"
        page = extract_rows(fetch_json(url))
        if not page:
            break
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += len(page)

    return rows


def build_terminal_occurrence_payload(
    *,
    terminal_nodes_payload: dict[str, Any],
    occurrence_rows_by_taxonid: dict[int, list[dict[str, Any]]],
) -> dict[str, Any]:
    terminal_taxonids = [int(taxonid) for taxonid in terminal_nodes_payload.get("terminal_taxonids", [])]
    taxa: dict[str, list[Any]] = {}

    for taxonid in terminal_taxonids:
        summary = summarize_occurrence_rows(occurrence_rows_by_taxonid.get(taxonid, []))
        if summary["occurrenceCount"] <= 0:
            continue
        taxa[str(taxonid)] = [
            summary["occurrenceCount"],
            summary["siteCount"],
            summary["datasetids"],
        ]

    return {
        "schema_version": 1,
        "taxagroupid": terminal_nodes_payload.get("taxagroupid"),
        "taxagroupname": terminal_nodes_payload.get("taxagroupname"),
        "fields": ["occurrenceCount", "siteCount", "datasetids"],
        "taxa": taxa,
    }


def safe_filename_part(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip())
    text = re.sub(r"_+", "_", text).strip("_")
    return text or "Unknown"


def parse_group_list(value: str | None) -> set[str]:
    if not value:
        return set()
    return {part.strip() for part in value.split(",") if part.strip()}


def default_output_filename(terminal_nodes_payload: dict[str, Any]) -> str:
    group_id = safe_filename_part(str(terminal_nodes_payload.get("taxagroupid") or "UNKNOWN"))
    group_name = safe_filename_part(str(terminal_nodes_payload.get("taxagroupname") or "Unknown"))
    return f"{group_id}_{group_name}.json"


def list_terminal_node_files(terminal_nodes_dir: Path, groups: set[str] | None = None) -> list[Path]:
    files: list[Path] = []
    for path in sorted(terminal_nodes_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        if groups:
            payload = load_json(path)
            if str(payload.get("taxagroupid") or "") not in groups:
                continue
        files.append(path)
    return files


def build_compact_payload_from_taxa(
    terminal_nodes_payload: dict[str, Any],
    taxa: dict[str, list[Any]],
    failed_taxonids: set[int] | None = None,
) -> dict[str, Any]:
    payload = {
        "schema_version": 1,
        "taxagroupid": terminal_nodes_payload.get("taxagroupid"),
        "taxagroupname": terminal_nodes_payload.get("taxagroupname"),
        "fields": ["occurrenceCount", "siteCount", "datasetids"],
        "taxa": taxa,
    }
    if failed_taxonids:
        payload["failed_taxonids"] = sorted(failed_taxonids)
    return payload


def build_checkpoint_payload_from_taxa(
    terminal_nodes_payload: dict[str, Any],
    taxa: dict[str, list[Any]],
    processed_taxonids: set[int],
    failed_taxonids: set[int],
) -> dict[str, Any]:
    payload = build_compact_payload_from_taxa(terminal_nodes_payload, taxa, failed_taxonids)
    payload["processed_taxonids"] = sorted(processed_taxonids)
    return payload


def build_occurrence_payload_for_terminal_nodes(
    *,
    api_base: str,
    page_size: int,
    terminal_nodes_payload: dict[str, Any],
    existing_taxa: dict[str, list[Any]] | None = None,
    existing_processed_taxonids: set[int] | None = None,
    existing_failed_taxonids: set[int] | None = None,
    resume_after_index: int = 0,
    skip_fetch_errors: bool = False,
    checkpoint_path: Path | None = None,
) -> dict[str, Any]:
    terminal_taxonids = [int(taxonid) for taxonid in terminal_nodes_payload.get("terminal_taxonids", [])]
    taxa: dict[str, list[Any]] = dict(existing_taxa or {})
    processed_taxonids: set[int] = set(existing_processed_taxonids or set())
    failed_taxonids: set[int] = set(existing_failed_taxonids or set())

    if resume_after_index > 0:
        processed_taxonids.update(terminal_taxonids[:resume_after_index])
        if checkpoint_path:
            write_json(
                checkpoint_path,
                build_checkpoint_payload_from_taxa(terminal_nodes_payload, taxa, processed_taxonids, failed_taxonids),
            )

    for index, taxonid in enumerate(terminal_taxonids, start=1):
        if taxonid in processed_taxonids:
            continue
        if str(taxonid) in taxa:
            log(f"{index}/{len(terminal_taxonids)} taxonid={taxonid}: already in checkpoint, skipping")
            processed_taxonids.add(taxonid)
            continue
        try:
            rows = fetch_occurrences_for_taxon(api_base, taxonid, page_size)
        except RuntimeError as exc:
            if not skip_fetch_errors:
                raise
            log(f"{index}/{len(terminal_taxonids)} taxonid={taxonid}: failed after retries, skipping ({exc})")
            failed_taxonids.add(taxonid)
            processed_taxonids.add(taxonid)
            if checkpoint_path:
                write_json(
                    checkpoint_path,
                    build_checkpoint_payload_from_taxa(terminal_nodes_payload, taxa, processed_taxonids, failed_taxonids),
                )
            continue
        summary = summarize_occurrence_rows(rows)
        if summary["occurrenceCount"] > 0:
            taxa[str(taxonid)] = [
                summary["occurrenceCount"],
                summary["siteCount"],
                summary["datasetids"],
            ]
        log(
            f"{index}/{len(terminal_taxonids)} taxonid={taxonid}: "
            f"{summary['occurrenceCount']} occurrences, {len(summary['datasetids'])} datasets"
        )
        processed_taxonids.add(taxonid)
        if checkpoint_path:
            write_json(
                checkpoint_path,
                build_checkpoint_payload_from_taxa(terminal_nodes_payload, taxa, processed_taxonids, failed_taxonids),
            )

    return build_compact_payload_from_taxa(terminal_nodes_payload, taxa, failed_taxonids)


def write_single_group_occurrence_payload(
    *,
    api_base: str,
    page_size: int,
    terminal_nodes_file: Path,
    output_dir: Path,
    output_file: str | None = None,
    force: bool = False,
    resume_after_index: int = 0,
    skip_fetch_errors: bool = False,
) -> None:
    terminal_nodes_payload = load_json(terminal_nodes_file)
    target_file = output_dir / (output_file or default_output_filename(terminal_nodes_payload))
    if target_file.exists() and not force:
        log(f"Skipping {target_file.name}; already exists. Use --force to regenerate.")
        return
    checkpoint_file = target_file.with_name(f"{target_file.stem}.partial{target_file.suffix}")
    existing_taxa: dict[str, list[Any]] = {}
    existing_processed_taxonids: set[int] = set()
    existing_failed_taxonids: set[int] = set()
    if checkpoint_file.exists() and not force:
        checkpoint_payload = load_json(checkpoint_file)
        if isinstance(checkpoint_payload.get("taxa"), dict):
            existing_taxa = checkpoint_payload["taxa"]
            log(f"Resuming {target_file.name} from {checkpoint_file.name} with {len(existing_taxa)} taxa")
        if isinstance(checkpoint_payload.get("processed_taxonids"), list):
            existing_processed_taxonids = {
                taxonid
                for value in checkpoint_payload["processed_taxonids"]
                if (taxonid := to_int(value)) is not None
            }
            log(f"Checkpoint has {len(existing_processed_taxonids)} processed taxonids")
        if isinstance(checkpoint_payload.get("failed_taxonids"), list):
            existing_failed_taxonids = {
                taxonid
                for value in checkpoint_payload["failed_taxonids"]
                if (taxonid := to_int(value)) is not None
            }
            log(f"Checkpoint has {len(existing_failed_taxonids)} failed taxonids")

    group_id = terminal_nodes_payload.get("taxagroupid") or terminal_nodes_file.stem
    group_name = terminal_nodes_payload.get("taxagroupname") or group_id
    log(f"Building {group_id} ({group_name}) from {terminal_nodes_file}")
    payload = build_occurrence_payload_for_terminal_nodes(
        api_base=api_base,
        page_size=page_size,
        terminal_nodes_payload=terminal_nodes_payload,
        existing_taxa=existing_taxa,
        existing_processed_taxonids=existing_processed_taxonids,
        existing_failed_taxonids=existing_failed_taxonids,
        resume_after_index=resume_after_index,
        skip_fetch_errors=skip_fetch_errors,
        checkpoint_path=checkpoint_file,
    )
    write_json(target_file, payload)
    if checkpoint_file.exists():
        checkpoint_file.unlink()
    log(f"Wrote {target_file}: {len(payload['taxa'])} taxa with occurrences")


def write_occurrence_summary_index(output_dir: Path) -> None:
    groups: dict[str, dict[str, str]] = {}

    for path in sorted(output_dir.glob("*.json")):
        if path.name == "index.json" or path.name.endswith(".partial.json"):
            continue
        try:
            payload = load_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        group_id = str(payload.get("taxagroupid") or "").strip()
        if not group_id:
            continue
        groups[group_id] = {
            "file": path.name,
            "taxagroupname": str(payload.get("taxagroupname") or group_id),
        }

    index_payload = {
        "schema_version": 1,
        "groups": dict(sorted(groups.items())),
    }
    write_json(output_dir / "index.json", index_payload)
    log(f"Wrote {output_dir / 'index.json'}: {len(groups)} groups")


def write_group_occurrence_payloads(
    *,
    api_base: str,
    page_size: int,
    terminal_nodes_dir: Path,
    output_dir: Path,
    groups: set[str] | None = None,
    force: bool = False,
    resume_after_index: int = 0,
    skip_fetch_errors: bool = False,
) -> None:
    files = list_terminal_node_files(terminal_nodes_dir, groups)
    log(f"Loaded {len(files)} terminal-node group files")
    for index, terminal_nodes_file in enumerate(files, start=1):
        log(f"Group {index}/{len(files)}")
        write_single_group_occurrence_payload(
            api_base=api_base,
            page_size=page_size,
            terminal_nodes_file=terminal_nodes_file,
            output_dir=output_dir,
            force=force,
            resume_after_index=resume_after_index,
            skip_fetch_errors=skip_fetch_errors,
        )
    write_occurrence_summary_index(output_dir)


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)

    if args.terminal_nodes_dir:
        write_group_occurrence_payloads(
            api_base=args.api_base,
            page_size=args.page_size,
            terminal_nodes_dir=Path(args.terminal_nodes_dir),
            output_dir=output_dir,
            groups=parse_group_list(args.groups),
            force=args.force,
            resume_after_index=args.resume_after_index,
            skip_fetch_errors=args.skip_fetch_errors,
        )
        return 0

    terminal_nodes_file = Path(args.terminal_nodes_file)
    write_single_group_occurrence_payload(
        api_base=args.api_base,
        page_size=args.page_size,
        terminal_nodes_file=terminal_nodes_file,
        output_dir=output_dir,
        output_file=args.output_file,
        force=args.force,
        resume_after_index=args.resume_after_index,
        skip_fetch_errors=args.skip_fetch_errors,
    )
    write_occurrence_summary_index(output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
