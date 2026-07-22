import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGroupOverviewRows,
  buildSyntheticRootRows,
  resolveGroupTreeRows,
} from '../src/groupTreeRows.js';

const groupRows = [
  {
    taxonid: 10,
    taxonname: 'Leaf A',
    taxagroupid: 'AAA',
    ids_root_to_leaf: [1, 2, 10],
    names_root_to_leaf: ['Root', 'Anchor', 'Leaf A'],
  },
  {
    taxonid: 11,
    taxonname: 'Leaf B',
    taxagroupid: 'AAA',
    ids_root_to_leaf: [1, 3, 11],
    names_root_to_leaf: ['Root', 'Other', 'Leaf B'],
  },
];

test('builds synthetic-root rows by slicing after a configured name', () => {
  const rows = buildSyntheticRootRows(groupRows, {
    rootId: -2001,
    rootName: 'Synthetic',
    sliceAfterName: 'Anchor',
  });

  assert.deepEqual(rows.map((row) => row.ids_root_to_leaf), [[-2001, 10]]);
  assert.deepEqual(rows.map((row) => row.names_root_to_leaf), [['Synthetic', 'Leaf A']]);
});

test('builds overview rows by prepending the configured root', () => {
  const rows = buildGroupOverviewRows(groupRows, {
    rootId: 0,
    rootName: 'Root',
  });

  assert.deepEqual(rows.map((row) => row.ids_root_to_leaf), [
    [0, 1, 2, 10],
    [0, 1, 3, 11],
  ]);
});

test('resolves synthetic group tree rows', () => {
  const result = resolveGroupTreeRows({
    taxagroupid: 'AAA',
    groupRows,
    syntheticGroupRoots: {
      AAA: { rootId: -2001, rootName: 'Synthetic', sliceAfterName: 'Anchor' },
    },
    groupOverviewConfig: {},
    getFilteredRows: () => [],
    getRootInfo: () => ({ rootId: 1, rootName: 'Root' }),
  });

  assert.equal(result.renderRootId, -2001);
  assert.equal(result.renderRootName, 'Synthetic');
  assert.equal(result.overviewConfig, null);
  assert.deepEqual(result.filteredRows.map((row) => row.taxonid), [10]);
});

test('resolves configured overview group rows', () => {
  const overview = { rootId: 0, rootName: 'Root', overviewDepth: 2 };
  const result = resolveGroupTreeRows({
    taxagroupid: 'AAA',
    groupRows,
    syntheticGroupRoots: {},
    groupOverviewConfig: { AAA: overview },
    getFilteredRows: () => [],
    getRootInfo: () => ({ rootId: 1, rootName: 'Root' }),
  });

  assert.equal(result.renderRootId, 0);
  assert.equal(result.renderRootName, 'Root');
  assert.equal(result.overviewConfig, overview);
  assert.equal(result.filteredRows.length, 2);
});

test('resolves a forest without altering or joining recorded taxonomic paths', () => {
  const forestRows = [
    groupRows[0],
    {
      ...groupRows[1],
      ids_root_to_leaf: [20, 21, 11],
      names_root_to_leaf: ['Second Root', 'Branch', 'Leaf B'],
    },
  ];
  const overview = {
    forest: true,
    layoutContainerId: '__layout_container_test__',
    overviewDepth: 4,
  };
  const result = resolveGroupTreeRows({
    taxagroupid: 'AAA',
    groupRows: forestRows,
    syntheticGroupRoots: {},
    groupOverviewConfig: { AAA: overview },
    getFilteredRows: () => [],
    getRootInfo: () => ({ rootId: 1, rootName: 'Root' }),
  });

  assert.equal(result.renderRootId, '__layout_container_test__');
  assert.equal(result.renderRootName, '');
  assert.equal(result.overviewConfig, overview);
  assert.deepEqual(result.filteredRows.map((row) => row.ids_root_to_leaf), [
    [1, 2, 10],
    [20, 21, 11],
  ]);
});

test('resolves normal group rows through provided callbacks', () => {
  const result = resolveGroupTreeRows({
    taxagroupid: 'AAA',
    groupRows,
    syntheticGroupRoots: {},
    groupOverviewConfig: {},
    getFilteredRows: (groupId) => groupRows.filter((row) => row.taxagroupid === groupId),
    getRootInfo: () => ({ rootId: 1, rootName: 'Root' }),
  });

  assert.equal(result.renderRootId, 1);
  assert.equal(result.renderRootName, 'Root');
  assert.equal(result.overviewConfig, null);
  assert.deepEqual(result.filteredRows, groupRows);
});
