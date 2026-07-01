"""Tests for terminal-node occurrence enrichment."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "generate_terminal_node_occurrences.py"
SPEC = importlib.util.spec_from_file_location("generate_terminal_node_occurrences", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
generate_terminal_node_occurrences = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generate_terminal_node_occurrences)


class GenerateTerminalNodeOccurrencesTests(unittest.TestCase):
    def test_summarizes_unique_occids_sites_and_datasetids(self) -> None:
        rows = [
            {"occid": 1, "site": {"siteid": 10, "datasetid": 100}},
            {"occid": 1, "site": {"siteid": 10, "datasetid": 100}},
            {"occid": 2, "site": {"siteid": 11, "datasetid": 101}},
            {"occid": 3, "site": {"siteid": 11, "datasetid": 101}},
        ]

        self.assertEqual(
            generate_terminal_node_occurrences.summarize_occurrence_rows(rows),
            {
                "occurrenceCount": 3,
                "siteCount": 2,
                "datasetids": [100, 101],
            },
        )

    def test_builds_enhanced_terminal_payload_without_zero_occurrence_taxa(self) -> None:
        payload = generate_terminal_node_occurrences.build_terminal_occurrence_payload(
            terminal_nodes_payload={
                "taxagroupid": "ACR",
                "taxagroupname": "Acritarchs",
                "terminal_taxonids": [47552, 47553],
            },
            occurrence_rows_by_taxonid={
                47552: [
                    {"occid": 1, "site": {"siteid": 10, "datasetid": 100}},
                    {"occid": 1, "site": {"siteid": 10, "datasetid": 100}},
                ],
                47553: [],
            },
        )

        self.assertEqual(payload["taxagroupid"], "ACR")
        self.assertEqual(payload["fields"], ["occurrenceCount", "siteCount", "datasetids"])
        self.assertEqual(payload["taxa"], {"47552": [1, 1, [100]]})
        self.assertNotIn("47553", payload["taxa"])

    def test_default_output_filename_matches_terminal_nodes_naming(self) -> None:
        self.assertEqual(
            generate_terminal_node_occurrences.default_output_filename(
                {"taxagroupid": "ACR", "taxagroupname": "Acritarchs"}
            ),
            "ACR_Acritarchs.json",
        )


if __name__ == "__main__":
    unittest.main()
