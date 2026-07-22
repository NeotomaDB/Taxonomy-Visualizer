import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TAXONOMIC_ISSUE_TYPES,
  findMissingSubordinateData,
  findShallowPlacements,
  findUnplacedTaxa,
  removeRowsByTaxonId,
  resolveGroupAnomalyRows,
} from '../src/groupAnomalyRows.js';

const allGroupRows = [
  {
    taxonid: 100,
    taxonname: 'Animalia',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [100],
    names_root_to_leaf: ['Animalia'],
  },
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
    taxonname: 'Shallow taxon',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [100, 3],
    names_root_to_leaf: ['Animalia', 'Shallow taxon'],
  },
  {
    taxonid: 4,
    taxonname: 'Wrong kingdom',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [200, 4],
    names_root_to_leaf: ['Plantae', 'Wrong kingdom'],
  },
  {
    taxonid: 5,
    taxonname: 'No recorded parent',
    taxagroupid: 'MAM',
    ids_root_to_leaf: [5],
    names_root_to_leaf: ['No recorded parent'],
  },
];

const filteredRows = allGroupRows.slice(0, 4);

test('finds only parentless terminal taxa as unplaced', () => {
  const rows = findUnplacedTaxa(allGroupRows);

  assert.deepEqual(rows.map((row) => row.taxonid), [5]);
});

test('finds terminal taxa directly below a broad root as shallow placements', () => {
  const rows = findShallowPlacements(allGroupRows);

  assert.deepEqual(rows.map((row) => row.taxonid), [3, 4]);
});

test('does not infer missing subordinate data from leaf status alone', () => {
  const rows = findMissingSubordinateData(allGroupRows);
  assert.deepEqual(rows, []);

  const markedRows = findMissingSubordinateData([
    ...allGroupRows,
    {
      taxonid: 6,
      taxonname: 'Expected parent',
      ids_root_to_leaf: [100, 1, 6],
      names_root_to_leaf: ['Animalia', 'Valid parent', 'Expected parent'],
      expects_subordinate_data: true,
    },
  ]);
  assert.deepEqual(markedRows.map((row) => row.taxonid), [6]);
});

test('removes rows by taxon id', () => {
  const rows = removeRowsByTaxonId(allGroupRows, [{ taxonid: 2 }, { taxonid: 4 }]);

  assert.deepEqual(rows.map((row) => row.taxonid), [100, 1, 3, 5]);
});

test('resolves the four-type issue model and renderable rows together', () => {
  const result = resolveGroupAnomalyRows(allGroupRows, filteredRows, 'MAM');

  assert.deepEqual(result.anomalies.map((row) => row.taxonid), [4]);
  assert.deepEqual(result.unplacedTaxa.map((row) => row.taxonid), [5]);
  assert.deepEqual(result.shallowPlacements.map((row) => row.taxonid), [3]);
  assert.deepEqual(result.missingSubordinateData, []);
  assert.deepEqual(
    result.issues.map((issue) => [issue.taxonid, issue.issueType]),
    [
      [5, TAXONOMIC_ISSUE_TYPES.UNPLACED],
      [3, TAXONOMIC_ISSUE_TYPES.SHALLOW_PLACEMENT],
      [4, TAXONOMIC_ISSUE_TYPES.PLACEMENT_CONFLICT],
    ],
  );
  assert.deepEqual(result.filteredRows.map((row) => row.taxonid), [100, 1, 2]);
});

test('does not classify an Acritarchs Chromista path as unplaced', () => {
  const acrRows = [
    {
      taxonid: 5241,
      taxonname: 'Acritarcha',
      taxagroupid: 'ACR',
      ids_root_to_leaf: [5241],
      names_root_to_leaf: ['Acritarcha'],
    },
    {
      taxonid: 47552,
      taxonname: 'Acritarch taxon',
      taxagroupid: 'ACR',
      ids_root_to_leaf: [5241, 47552],
      names_root_to_leaf: ['Acritarcha', 'Acritarch taxon'],
    },
    {
      taxonid: 47092,
      taxonname: 'Halodinium',
      taxagroupid: 'ACR',
      ids_root_to_leaf: [32182, 32178, 32185, 31303, 47094, 47092],
      names_root_to_leaf: [
        'Eukaryota',
        'Chromista',
        'Alveolata',
        'Ciliophora',
        'Prorodontida',
        'Halodinium',
      ],
    },
  ];

  const classificationRows = acrRows.slice(0, 2);
  const result = resolveGroupAnomalyRows(acrRows, acrRows, 'ACR', {
    classificationRows,
  });

  assert.equal(result.issues.some((issue) => issue.taxonid === 47092), false);
  assert.deepEqual(result.unplacedTaxa, []);
  assert.equal(result.filteredRows.some((row) => row.taxonid === 47092), true);

  const canvasIds = new Set(result.filteredRows.map((row) => row.taxonid));
  const issueIds = new Set(result.issues.map((issue) => issue.taxonid));
  assert.deepEqual(
    acrRows.map((row) => row.taxonid).sort((a, b) => a - b),
    [...new Set([...canvasIds, ...issueIds])].sort((a, b) => a - b),
  );
  assert.deepEqual([...canvasIds].filter((id) => issueIds.has(id)), []);
});
