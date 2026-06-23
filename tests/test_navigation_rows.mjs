import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNavigationRows, sliceRowsFromNode } from '../src/navigationRows.js';

const groupRows = [
  {
    taxonid: 10,
    taxonname: 'Leaf A',
    taxagroupid: 'AAA',
    ids_root_to_leaf: [1, 2, 10],
    names_root_to_leaf: ['Root', 'Branch', 'Leaf A'],
  },
  {
    taxonid: 11,
    taxonname: 'Leaf B',
    taxagroupid: 'AAA',
    ids_root_to_leaf: [1, 2, 11],
    names_root_to_leaf: ['Root', 'Branch', 'Leaf B'],
  },
  {
    taxonid: 99,
    taxonname: 'Standalone',
    taxagroupid: 'AAA',
    ids_root_to_leaf: [99],
    names_root_to_leaf: ['Standalone'],
  },
];

test('slices rows from a navigated node', () => {
  const rows = sliceRowsFromNode(groupRows, 2);

  assert.deepEqual(rows.map((row) => row.ids_root_to_leaf), [
    [2, 10],
    [2, 11],
  ]);
  assert.deepEqual(rows.map((row) => row.names_root_to_leaf), [
    ['Branch', 'Leaf A'],
    ['Branch', 'Leaf B'],
  ]);
});

test('builds normal navigation rows for a clicked node', () => {
  const result = buildNavigationRows({
    nodeId: 2,
    nodeName: 'Branch',
    taxagroupid: 'AAA',
    groupRows,
    rowsContainingNode: groupRows.slice(0, 2),
  });

  assert.equal(result.isSyntheticTaxagroupidNode, false);
  assert.equal(result.renderRootId, 2);
  assert.equal(result.renderRootName, 'Branch');
  assert.equal(result.rootNodesToRender, null);
  assert.deepEqual(result.filteredRows.map((row) => row.taxonid), [10, 11]);
});

test('builds synthetic orphan navigation rows for orphan group nodes', () => {
  const result = buildNavigationRows({
    nodeId: -1000001,
    nodeName: 'AAA',
    taxagroupid: 'AAA',
    groupRows,
    rowsContainingNode: [],
  });

  assert.equal(result.isSyntheticTaxagroupidNode, true);
  assert.equal(result.renderRootId, -999999);
  assert.equal(result.renderRootName, 'Root');
  assert.equal(result.filteredRows, groupRows);
  assert.deepEqual(result.rootNodesToRender, [
    {
      id: -1000001,
      name: 'AAA',
      taxagroupid: 'AAA',
      children: [
        {
          id: 99,
          name: 'Standalone',
          taxagroupid: 'AAA',
          children: [],
        },
      ],
    },
  ]);
});
