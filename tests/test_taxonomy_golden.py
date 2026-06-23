"""Regression tests for the compact taxonomy data contract."""

from __future__ import annotations

import json
import unittest

from split_baseline import GOLDEN_BASELINE, build_baseline, load_split_rows


class TaxonomyGoldenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rows = load_split_rows()
        with GOLDEN_BASELINE.open(encoding="utf-8") as handle:
            cls.golden = json.load(handle)

    def test_split_data_matches_golden_baseline(self) -> None:
        self.assertEqual(build_baseline(self.rows), self.golden)

    def test_split_row_invariants(self) -> None:
        seen_ids: set[int] = set()
        for row in self.rows:
            taxon_id = row["taxonid"]
            self.assertNotIn(taxon_id, seen_ids)
            self.assertTrue(row["taxagroupid"])
            self.assertTrue(row["path_ids"])
            self.assertEqual(row["path_ids"][-1], taxon_id)
            self.assertEqual(len(row["path_ids"]), len(row["path_names"]))
            self.assertEqual(row["path_names"][-1], row["taxonname"])
            self.assertEqual(row["taxonname"], row["taxonname"].strip())
            seen_ids.add(taxon_id)


if __name__ == "__main__":
    unittest.main()

