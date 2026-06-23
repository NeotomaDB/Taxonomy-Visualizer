import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTreeBaselines, getAllTaxagroupIds } from './tree_baseline.mjs';

test('weekly compact payload builds all 51 taxon group trees', () => {
  const groupIds = getAllTaxagroupIds();
  assert.equal(groupIds.length, 51);

  const { summary } = buildTreeBaselines(groupIds);
  assert.deepEqual(Object.keys(summary.groups).sort(), groupIds);
  for (const groupId of groupIds) {
    const tree = summary.groups[groupId];
    assert.ok(tree.input_row_count > 0, `${groupId} has no input rows`);
    assert.ok(tree.node_count > 0, `${groupId} has no tree nodes`);
    assert.equal(tree.edge_count, tree.node_count - 1, `${groupId} is not a tree`);
    assert.ok(tree.leaf_count > 0, `${groupId} has no leaves`);
    assert.ok(tree.structure_sha256, `${groupId} has no structure hash`);
  }
});

