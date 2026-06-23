import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInitialTrees, initialTreeNodesToRows } from '../src/initialView.js';

const rows = [
  {
    taxonid: 4,
    taxonname: 'Mammalia',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [1, 2, 3, 4],
    names_root_to_leaf: ['Eukaryota', 'Animalia', 'Vertebrata', 'Mammalia'],
  },
  {
    taxonid: 5,
    taxonname: 'Aves',
    taxagroupid: 'AVE',
    ids_root_to_leaf: [1, 2, 3, 5],
    names_root_to_leaf: ['Eukaryota', 'Animalia', 'Vertebrata', 'Aves'],
  },
  {
    taxonid: 20,
    taxonname: 'Standalone',
    taxagroupid: 'ZZZ',
    ids_root_to_leaf: [20],
    names_root_to_leaf: ['Standalone'],
  },
  {
    taxonid: 30,
    taxonname: 'Chemical',
    taxagroupid: 'CHM',
    ids_root_to_leaf: [30, 31, 32, 33],
    names_root_to_leaf: ['Chemical root', 'Compound', 'Steroid', 'Leaf'],
  },
  {
    taxonid: 40,
    taxonname: 'Off anchor',
    taxagroupid: 'ANC',
    ids_root_to_leaf: [40, 41, 42],
    names_root_to_leaf: ['Other root', 'Other branch', 'Off anchor'],
  },
  {
    taxonid: 52,
    taxonname: 'Anchored leaf',
    taxagroupid: 'ANC',
    ids_root_to_leaf: [50, 51, 52],
    names_root_to_leaf: ['Anchor root', 'Anchor', 'Anchored leaf'],
  },
  {
    taxonid: 53,
    taxonname: 'Anchored leaf two',
    taxagroupid: 'ANC',
    ids_root_to_leaf: [50, 51, 53],
    names_root_to_leaf: ['Anchor root', 'Anchor', 'Anchored leaf two'],
  },
];

test('builds initial bio trees and groups standalone orphans', () => {
  const trees = buildInitialTrees(rows, {
    currentTaxonType: 'bio',
    nonBioGroups: new Set(['CHM']),
    anchorIds: new Set([3]),
  });

  assert.equal(trees.mainTree.length, 1);
  assert.equal(trees.mainTree[0].name, 'Eukaryota');
  assert.equal(trees.orphanTree.some((node) => node.taxagroupid === 'ZZZ'), true);
  assert.equal(trees.mainTree[0].children[0].children[0].isAnchor, true);
});

test('builds initial non-bio trees when requested', () => {
  const trees = buildInitialTrees(rows, {
    currentTaxonType: 'nonbio',
    nonBioGroups: new Set(['CHM']),
  });

  assert.equal(trees.mainTree.length, 1);
  assert.equal(trees.mainTree[0].name, 'Chemical root');
});

test('uses anchor config to skip off-anchor overview paths', () => {
  const trees = buildInitialTrees(rows, {
    anchorDataMap: new Map([
      ['ANC', { anchorId: 51, anchorName: 'Anchor' }],
    ]),
  });

  const renderedRows = initialTreeNodesToRows(trees.mainTree);
  assert.equal(renderedRows.some((row) => row.taxonid === 51), true);
  assert.equal(renderedRows.some((row) => row.taxonid === 42), false);
});

test('converts initial tree nodes back into renderer rows', () => {
  const rowsForRender = initialTreeNodesToRows([
    {
      id: 1,
      name: 'Root',
      taxagroupid: 'AAA',
      children: [{ id: 2, name: 'Leaf', taxagroupid: 'AAA' }],
    },
  ]);

  assert.deepEqual(rowsForRender, [
    {
      taxonid: 2,
      taxonname: 'Leaf',
      ids_root_to_leaf: [1, 2],
      names_root_to_leaf: ['Root', 'Leaf'],
      taxagroupid: 'AAA',
    },
  ]);
});
