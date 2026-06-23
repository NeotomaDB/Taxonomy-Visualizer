import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  SMALL_TREE_GOLDEN,
  TREE_GOLDEN,
  buildTreeBaselines,
  getAllTaxagroupIds,
} from './tree_baseline.mjs';

test('compact payload matches golden trees across all 51 taxon groups', () => {
  const groupIds = getAllTaxagroupIds();
  assert.equal(groupIds.length, 51);

  const actual = buildTreeBaselines(groupIds);
  const expectedSummary = JSON.parse(fs.readFileSync(TREE_GOLDEN, 'utf8'));
  const expectedSmallTree = JSON.parse(fs.readFileSync(SMALL_TREE_GOLDEN, 'utf8'));

  assert.deepEqual(actual.summary, expectedSummary);
  assert.deepEqual(actual.smallTree, expectedSmallTree);
});

