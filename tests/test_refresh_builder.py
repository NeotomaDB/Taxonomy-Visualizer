import importlib.util
import sys
from pathlib import Path
from unittest import TestCase


ROOT_DIR = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT_DIR / "scripts" / "refresh_taxonomy.py"

spec = importlib.util.spec_from_file_location("refresh_taxonomy", MODULE_PATH)
refresh_taxonomy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = refresh_taxonomy
spec.loader.exec_module(refresh_taxonomy)


class RefreshBuilderTests(TestCase):
    def test_structured_paths_preserve_commas_in_names(self) -> None:
        taxa_rows = [
            {"taxonid": 1, "taxonname": "Root", "highertaxonid": None, "taxagroupid": "TST"},
            {"taxonid": 2, "taxonname": "Name, with comma", "highertaxonid": 1, "taxagroupid": "TST"},
        ]

        taxonpaths = refresh_taxonomy.build_taxonpaths_from_taxa(taxa_rows)
        row = next(row for row in taxonpaths["taxonpaths"] if row["taxonid"] == 2)

        self.assertEqual(row["path_ids"], [1, 2])
        self.assertEqual(row["path_names"], ["Root", "Name, with comma"])
        self.assertNotIn("array_to_string", row)
        self.assertNotIn("taxonnames", row)

        names, paths = refresh_taxonomy.build_split_taxonomy(taxonpaths)
        path_lookup = refresh_taxonomy.build_path_lookup(taxonpaths)

        self.assertEqual(names["2"], "Name, with comma")
        self.assertEqual(paths["paths"], [["TST", [1, 2]], ["TST", [1]]])
        self.assertEqual(path_lookup[2]["path_names"], ["Root", "Name, with comma"])
