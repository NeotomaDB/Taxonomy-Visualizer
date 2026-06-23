"""Dynamic integrity checks suitable for the weekly taxonomy refresh workflow."""

from __future__ import annotations

import json
import unittest

from split_baseline import NAMES_FILE, PATHS_FILE


class RefreshParityTests(unittest.TestCase):
    def test_compact_payload_is_internally_consistent(self) -> None:
        with NAMES_FILE.open(encoding="utf-8") as handle:
            names = json.load(handle)
        with PATHS_FILE.open(encoding="utf-8") as handle:
            payload = json.load(handle)

        self.assertEqual(payload.get("schema_version"), 1)
        self.assertTrue(names)
        self.assertTrue(all(name == name.strip() for name in names.values()))

        seen_ids: set[int] = set()
        referenced_ids: set[int] = set()
        for group_id, path_ids in payload.get("paths", []):
            self.assertTrue(group_id)
            self.assertTrue(path_ids)
            taxon_id = int(path_ids[-1])
            self.assertNotIn(taxon_id, seen_ids)
            seen_ids.add(taxon_id)
            referenced_ids.update(map(int, path_ids))

        name_ids = set(map(int, names))
        self.assertEqual(seen_ids, name_ids)
        self.assertEqual(referenced_ids, name_ids)


if __name__ == "__main__":
    unittest.main()

