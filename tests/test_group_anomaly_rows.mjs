import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findShallowOrphans,
  findShortValidRows,
  removeRowsByTaxonId,
  resolveGroupAnomalyRows,
} from '../src/groupAnomalyRows.js';

const allGroupRows = [
  {
    taxonid: 1,
    taxonname: 'Valid parent',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [100, 1],
    names_root_to_leaf: ['Animalia', 'Valid parent'],
  },
  {
    taxonid: 2,
    taxonname: 'Valid child',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [100, 1, 2],
    names_root_to_leaf: ['Animalia', 'Valid parent', 'Valid child'],
  },
  {
    taxonid: 3,
    taxonname: 'Short valid',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [100, 3],
    names_root_to_leaf: ['Animalia', 'Short valid'],
  },
  {
    taxonid: 4,
    taxonname: 'Wrong kingdom',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [200, 4],
    names_root_to_leaf: ['Plantae', 'Wrong kingdom'],
  },
];

const filteredRows = allGroupRows.slice(0, 2);

test('finds short valid rows not present in the rendered tree and not anomalous', () => {
  const rows = findShortValidRows(allGroupRows, filteredRows, [{ taxonid: 4 }]);

  assert.deepEqual(rows.map((row) => row.taxonid), [3]);
});

test('finds shallow orphans inside rendered rows', () => {
  const rows = findShallowOrphans([
    ...filteredRows,
    {
      taxonid: 5,
      taxonname: 'Shallow orphan',
      ids_root_to_leaf: [100, 5],
      names_root_to_leaf: ['Animalia', 'Shallow orphan'],
    },
  ]);

  assert.deepEqual(rows.map((row) => row.taxonid), [5]);
});

test('removes rows by taxon id', () => {
  const rows = removeRowsByTaxonId(allGroupRows, [{ taxonid: 2 }, { taxonid: 4 }]);

  assert.deepEqual(rows.map((row) => row.taxonid), [1, 3]);
});

test('resolves anomalies, orphan nodes, and renderable rows together', () => {
  const result = resolveGroupAnomalyRows(allGroupRows, [
    ...filteredRows,
    {
      taxonid: 5,
      taxonname: 'Shallow orphan',
      taxagroupid: 'MAM',
      ids_root_to_leaf: [100, 5],
      names_root_to_leaf: ['Animalia', 'Shallow orphan'],
    },
  ], 'MAM');

  assert.deepEqual(result.anomalies.map((row) => row.taxonid), [4]);
  assert.deepEqual(result.shortValidRows.map((row) => row.taxonid), [3]);
  assert.deepEqual(result.shallowOrphans.map((row) => row.taxonid), [5]);
  assert.deepEqual(result.orphanNodes.map((row) => row.taxonid), [3, 5]);
  assert.deepEqual(result.filteredRows.map((row) => row.taxonid), [1, 2]);
});
