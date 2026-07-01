#!/usr/bin/env python3
"""Generate per-biological-taxagroup terminal-node JSON files.

This script is intentionally local-data only: it reads the compact taxonomy
assets already used by the frontend and does not call the Neotoma API.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


NON_BIO_GROUPS = {
    "WCH",
    "BIM",
    "AQU",
    "PHY",
    "MAG",
    "CHM",
    "SED",
    "LOI",
    "LAB",
    "CAR",
    "ISO",
    "CHR",
    "UPA",
    "DNA",
    "PHT",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--paths-file", default="data/taxon_paths_ids.json")
    parser.add_argument("--names-file", default="data/taxon_names.json")
    parser.add_argument("--taxagroup-names-file", default="data/taxagroup_names.json")
    parser.add_argument("--output-dir", default="data/terminal_nodes")
    parser.add_argument(
        "--groups",
        default="",
        help="Optional comma-separated taxagroupids. Defaults to all biological taxon groups.",
    )
    parser.add_argument(
        "--include-non-bio",
        action="store_true",
        help="Include non-biological taxagroups instead of excluding the frontend NON_BIO_GROUPS set.",
    )
    return parser.parse_args()


def log(message: str) -> None:
    print(f"[generate_terminal_nodes] {message}", file=sys.stderr)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def safe_filename_part(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip())
    text = re.sub(r"_+", "_", text).strip("_")
    return text or "Unknown"


def parse_group_list(value: str | None) -> list[str]:
    if not value:
        return []
    seen: set[str] = set()
    groups: list[str] = []
    for part in value.split(","):
        group = part.strip()
        if not group or group in seen:
            continue
        seen.add(group)
        groups.append(group)
    return groups


def group_path_rows(paths_payload: dict[str, Any]) -> dict[str, list[list[int]]]:
    grouped: dict[str, list[list[int]]] = defaultdict(list)
    for row in paths_payload.get("paths", []):
        if not isinstance(row, list | tuple) or len(row) != 2:
            continue
        group_id, path_ids = row
        if not group_id or not isinstance(path_ids, list) or not path_ids:
            continue
        ids: list[int] = []
        for value in path_ids:
            try:
                ids.append(int(value))
            except (TypeError, ValueError):
                continue
        if ids:
            grouped[str(group_id)].append(ids)
    return dict(grouped)


def resolve_biological_groups(
    grouped_paths: dict[str, list[list[int]]],
    taxagroup_names: dict[str, str],
    requested_groups: list[str] | None = None,
    include_non_bio: bool = False,
) -> list[str]:
    if requested_groups:
        return [group for group in requested_groups if group in grouped_paths]

    groups = sorted(group for group in grouped_paths if group in taxagroup_names)
    if include_non_bio:
        return groups
    return [group for group in groups if group not in NON_BIO_GROUPS]


def build_terminal_nodes_for_group(
    *,
    taxagroupid: str,
    taxagroupname: str,
    path_rows: list[list[int]],
    taxon_names: dict[str, str],
    generated_at: str,
) -> dict[str, Any]:
    terminal_candidate_ids = {path[-1] for path in path_rows if path}
    internal_ids = {taxon_id for path in path_rows for taxon_id in path[:-1]}
    terminal_ids = terminal_candidate_ids - internal_ids

    terminal_taxonids = sorted(
        terminal_ids,
        key=lambda taxon_id: (taxon_names.get(str(taxon_id), str(taxon_id)).lower(), taxon_id),
    )

    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "taxagroupid": taxagroupid,
        "taxagroupname": taxagroupname,
        "fields": ["taxonid"],
        "counts": {
            "pathRows": len(path_rows),
            "uniqueTaxa": len(terminal_candidate_ids),
            "internalNodes": len(internal_ids),
            "terminalNodes": len(terminal_taxonids),
        },
        "terminal_taxonids": terminal_taxonids,
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def build_terminal_node_files(
    *,
    paths_payload: dict[str, Any],
    taxon_names: dict[str, str],
    taxagroup_names: dict[str, str],
    requested_groups: list[str] | None = None,
    include_non_bio: bool = False,
    generated_at: str | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    grouped_paths = group_path_rows(paths_payload)
    groups = resolve_biological_groups(grouped_paths, taxagroup_names, requested_groups, include_non_bio)
    generated_at = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    files: dict[str, dict[str, Any]] = {}
    index_groups: list[dict[str, Any]] = []
    for group_id in groups:
        group_name = taxagroup_names.get(group_id, group_id)
        filename = f"{safe_filename_part(group_id)}_{safe_filename_part(group_name)}.json"
        payload = build_terminal_nodes_for_group(
            taxagroupid=group_id,
            taxagroupname=group_name,
            path_rows=grouped_paths[group_id],
            taxon_names=taxon_names,
            generated_at=generated_at,
        )
        files[filename] = payload
        index_groups.append(
            {
                "taxagroupid": group_id,
                "taxagroupname": group_name,
                "file": filename,
                **payload["counts"],
            }
        )

    index_groups.sort(key=lambda item: (item["taxagroupname"].lower(), item["taxagroupid"]))
    index_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "source_files": {
            "paths": "data/taxon_paths_ids.json",
            "names": "data/taxon_names.json",
            "taxagroup_names": "data/taxagroup_names.json",
        },
        "excluded_non_bio_groups": [] if include_non_bio else sorted(NON_BIO_GROUPS),
        "counts": {
            "taxagroups": len(index_groups),
            "terminalNodes": sum(item["terminalNodes"] for item in index_groups),
        },
        "groups": index_groups,
    }
    return index_payload, files


def main() -> int:
    args = parse_args()
    paths_file = Path(args.paths_file)
    names_file = Path(args.names_file)
    taxagroup_names_file = Path(args.taxagroup_names_file)
    output_dir = Path(args.output_dir)

    index_payload, files = build_terminal_node_files(
        paths_payload=load_json(paths_file),
        taxon_names=load_json(names_file),
        taxagroup_names=load_json(taxagroup_names_file),
        requested_groups=parse_group_list(args.groups),
        include_non_bio=args.include_non_bio,
    )

    write_json(output_dir / "index.json", index_payload)
    for filename, payload in files.items():
        write_json(output_dir / filename, payload)
        log(
            f"Wrote {filename}: "
            f"{payload['counts']['terminalNodes']} terminal nodes "
            f"from {payload['counts']['pathRows']} path rows"
        )

    log(
        f"Wrote {len(files)} taxagroup files with "
        f"{index_payload['counts']['terminalNodes']} total terminal nodes"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
