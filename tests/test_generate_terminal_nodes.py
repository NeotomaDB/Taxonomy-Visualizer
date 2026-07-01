"""Tests for local terminal-node generation."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "generate_terminal_nodes.py"
SPEC = importlib.util.spec_from_file_location("generate_terminal_nodes", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
generate_terminal_nodes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generate_terminal_nodes)


class GenerateTerminalNodesTests(unittest.TestCase):
    def test_builds_biological_terminal_nodes(self) -> None:
        paths_payload = {
            "schema_version": 1,
            "paths": [
                ["MAM", [1]],
                ["MAM", [1, 2]],
                ["MAM", [1, 2, 3]],
                ["MAM", [1, 4]],
                ["WCH", [10]],
                ["WCH", [10, 11]],
            ],
        }
        taxon_names = {
            "1": "Mammalia",
            "2": "Bison",
            "3": "Bison bison",
            "4": "Canis",
            "10": "Water chemistry",
            "11": "pH",
        }
        taxagroup_names = {
            "MAM": "Mammals",
            "WCH": "Water chemistry",
        }

        index_payload, files = generate_terminal_nodes.build_terminal_node_files(
            paths_payload=paths_payload,
            taxon_names=taxon_names,
            taxagroup_names=taxagroup_names,
            generated_at="2026-06-29T00:00:00+00:00",
        )

        self.assertEqual(index_payload["counts"], {"taxagroups": 1, "terminalNodes": 2})
        self.assertEqual(set(files), {"MAM_Mammals.json"})
        self.assertEqual(
            files["MAM_Mammals.json"]["terminal_taxonids"],
            [3, 4],
        )
        self.assertEqual(files["MAM_Mammals.json"]["fields"], ["taxonid"])

    def test_can_generate_requested_non_bio_group(self) -> None:
        index_payload, files = generate_terminal_nodes.build_terminal_node_files(
            paths_payload={"paths": [["WCH", [10, 11]]]},
            taxon_names={"10": "Water chemistry", "11": "pH"},
            taxagroup_names={"WCH": "Water chemistry"},
            requested_groups=["WCH"],
            generated_at="2026-06-29T00:00:00+00:00",
        )

        self.assertEqual(index_payload["counts"], {"taxagroups": 1, "terminalNodes": 1})
        self.assertEqual(set(files), {"WCH_Water_chemistry.json"})


if __name__ == "__main__":
    unittest.main()
