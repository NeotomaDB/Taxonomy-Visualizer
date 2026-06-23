import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTaxonomyIndexes,
  extractTaxaGroups,
  filterRowsByGroup,
  getRootInfo,
  getRowsContainingNode,
  getRowsForGroup,
} from '../src/taxonomyIndex.js';

const rows = [
  {
    taxonid: 10,
    taxonname: 'Leaf A',
    taxagroupid: 'AAA',
    ids_root_to_leaf: [1, 2, 10],
    names_root_to_leaf: ['Root One', 'Anchor', 'Leaf A'],
  },
  {
    taxonid: 11,
    taxonname: 'Leaf B',
    taxagroupid: 'AAA',
    ids_root_to_leaf: [1, 3, 11],
    names_root_to_leaf: ['Root One', 'Branch', 'Leaf B'],
  },
  {
    taxonid: 20,
    taxonname: 'Leaf C',
    taxagroupid: 'BBB',
    ids_root_to_leaf: [9, 20],
    names_root_to_leaf: ['Root Nine', 'Leaf C'],
  },
  {
    taxonid: 21,
    taxonname: 'Leaf D',
    taxagroupid: 'BBB',
    ids_root_to_leaf: [8, 21],
    names_root_to_leaf: ['Root Eight', 'Leaf D'],
  },
  {
    taxonid: 22,
    taxonname: 'Leaf E',
    taxagroupid: 'BBB',
    ids_root_to_leaf: [8, 22],
    names_root_to_leaf: ['Root Eight', 'Leaf E'],
  },
];

test('indexes rows by group and node id', () => {
  const indexes = buildTaxonomyIndexes(rows);

  assert.deepEqual(extractTaxaGroups(rows), ['AAA', 'BBB']);
  assert.equal(getRowsForGroup(indexes, 'AAA').length, 2);
  assert.equal(getRowsContainingNode(indexes, 1).length, 2);
  assert.equal(indexes.nameById.get(10), 'Leaf A');
});

test('filters anchored groups from the configured anchor', () => {
  const indexes = buildTaxonomyIndexes(rows);
  const anchors = new Map([
    ['AAA', { anchorId: 2, anchorName: 'Anchor' }],
  ]);

  const filtered = filterRowsByGroup(indexes, 'AAA', anchors);

  assert.equal(filtered.length, 1);
  assert.deepEqual(filtered[0].ids_root_to_leaf, [2, 10]);
  assert.deepEqual(getRootInfo(indexes, 'AAA', anchors), {
    rootId: 2,
    rootName: 'Anchor',
  });
});

test('uses the most common root for non-anchored groups', () => {
  const indexes = buildTaxonomyIndexes(rows);

  const filtered = filterRowsByGroup(indexes, 'BBB');

  assert.deepEqual(filtered.map((row) => row.taxonid), [21, 22]);
  assert.deepEqual(getRootInfo(indexes, 'BBB'), {
    rootId: 8,
    rootName: 'Root Eight',
  });
});
