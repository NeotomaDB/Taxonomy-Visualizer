"""Build a deterministic semantic snapshot of the compact taxonomy payload."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
NAMES_FILE = ROOT / "data" / "taxon_names.json"
PATHS_FILE = ROOT / "data" / "taxon_paths_ids.json"
GOLDEN_BASELINE = ROOT / "tests" / "golden" / "taxonomy_data_baseline.json"


def load_split_rows() -> list[dict[str, Any]]:
    with NAMES_FILE.open(encoding="utf-8") as handle:
        names = json.load(handle)
    with PATHS_FILE.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if payload.get("schema_version") != 1:
        raise ValueError("Unsupported compact taxonomy schema")

    rows = []
    for group_id, path_ids in payload.get("paths", []):
        if not path_ids:
            raise ValueError("Compact taxonomy paths must not be empty")
        taxon_id = int(path_ids[-1])
        rows.append(
            {
                "taxonid": taxon_id,
                "taxonname": names[str(taxon_id)],
                "taxagroupid": str(group_id),
                "path_ids": [int(node_id) for node_id in path_ids],
                "path_names": [names[str(node_id)] for node_id in path_ids],
            }
        )
    return rows


def digest_records(records: Iterable[Any]) -> str:
    digest = hashlib.sha256()
    for record in records:
        encoded = json.dumps(
            record,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        digest.update(encoded)
        digest.update(b"\n")
    return digest.hexdigest()


def build_baseline(rows: list[dict[str, Any]]) -> dict[str, Any]:
    canonical_rows = sorted(rows, key=lambda row: row["taxonid"])
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    all_nodes: set[int] = set()
    all_edges: set[tuple[int, int]] = set()

    for row in canonical_rows:
        groups[row["taxagroupid"]].append(row)
        all_nodes.update(row["path_ids"])
        all_edges.update(zip(row["path_ids"], row["path_ids"][1:]))

    group_summaries = {}
    for group_id, group_rows in sorted(groups.items()):
        nodes = {node_id for row in group_rows for node_id in row["path_ids"]}
        edges = {
            edge
            for row in group_rows
            for edge in zip(row["path_ids"], row["path_ids"][1:])
        }
        roots = sorted({row["path_ids"][0] for row in group_rows})
        group_summaries[group_id] = {
            "row_count": len(group_rows),
            "node_count": len(nodes),
            "edge_count": len(edges),
            "root_ids": roots,
            "rows_sha256": digest_records(group_rows),
            "edges_sha256": digest_records(sorted(edges)),
        }

    return {
        "schema_version": 2,
        "sources": ["data/taxon_names.json", "data/taxon_paths_ids.json"],
        "row_count": len(canonical_rows),
        "group_count": len(group_summaries),
        "node_count": len(all_nodes),
        "edge_count": len(all_edges),
        "rows_sha256": digest_records(canonical_rows),
        "edges_sha256": digest_records(sorted(all_edges)),
        "groups": group_summaries,
    }


def write_baseline(path: Path = GOLDEN_BASELINE) -> None:
    baseline = build_baseline(load_split_rows())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(baseline, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    write_baseline()

