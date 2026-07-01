import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExplorerUrl,
  fetchTaxonSummaryRecord,
  getTaxonSummaryRecord,
  isOccurrenceSummaryEnabled,
  normalizeTaxonOccurrenceRecord,
} from '../src/taxonSummary.js';

test('normalizes terminal occurrence records', () => {
  assert.deepEqual(
    normalizeTaxonOccurrenceRecord([14, 8, [40, '15', null, 'x']]),
    {
      occurrenceCount: 14,
      siteCount: 8,
      datasetids: [40, 15],
      datasetCount: 2,
    },
  );
  assert.equal(normalizeTaxonOccurrenceRecord([0, 0, []]), null);
});

test('reads taxon summary records by taxonid', () => {
  const payload = {
    taxa: {
      47552: [2, 1, [14, 15]],
    },
  };

  assert.deepEqual(getTaxonSummaryRecord(payload, 47552), {
    occurrenceCount: 2,
    siteCount: 1,
    datasetids: [14, 15],
    datasetCount: 2,
  });
  assert.equal(getTaxonSummaryRecord(payload, 999), null);
});

test('builds Neotoma Explorer datasetids link', () => {
  assert.equal(
    buildExplorerUrl([14, '13', 15]),
    'https://apps.neotomadb.org/explorer/?datasetids=14,13,15',
  );
  assert.equal(buildExplorerUrl([]), null);
});

test('treats non-empty taxagroup ids as occurrence-summary candidates', () => {
  assert.equal(isOccurrenceSummaryEnabled('ACR'), true);
  assert.equal(isOccurrenceSummaryEnabled('mam'), true);
  assert.equal(isOccurrenceSummaryEnabled(''), false);
});

test('loads non-ACR occurrence summaries through the manifest', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/index.json')) {
      return {
        ok: true,
        async json() {
          return {
            groups: {
              ALG: { file: 'ALG_Algae.json' },
            },
          };
        },
      };
    }
    if (String(url).endsWith('/ALG_Algae.json')) {
      return {
        ok: true,
        async json() {
          return {
            taxa: {
              123: [9, 4, [10, 11]],
            },
          };
        },
      };
    }
    return { ok: false, async json() { return {}; } };
  };

  try {
    assert.deepEqual(await fetchTaxonSummaryRecord(123, 'ALG'), {
      occurrenceCount: 9,
      siteCount: 4,
      datasetids: [10, 11],
      datasetCount: 2,
    });
    assert.deepEqual(calls, [
      'data/terminal_nodes_datasetids/index.json',
      'data/terminal_nodes_datasetids/ALG_Algae.json',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
