import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSynonymRelationships } from '../src/synonym_bar.js';

test('builds one invalid-to-valid relationship for each synonym record', () => {
  const rows = [
    { taxonid: 44440, taxonname: 'Artibeus phaeotis' },
    { taxonid: 44440, taxonname: 'Duplicate row' },
  ];
  const getSynonymInfo = () => ({
    validId: 44439,
    validName: 'Dermanura phaeotis',
    synonyms: [{
      invalid_id: 44440,
      invalid_name: 'Artibeus phaeotis',
      synonymtype: 'nomenclatural synonym',
      recdatemodified: '2021-06-17T20:02:20.000Z',
    }],
  });

  assert.deepEqual(buildSynonymRelationships(rows, getSynonymInfo), [{
    invalidId: 44440,
    invalidName: 'Artibeus phaeotis',
    validId: 44439,
    validName: 'Dermanura phaeotis',
    synonymtype: 'nomenclatural synonym',
    recdatemodified: '2021-06-17T20:02:20.000Z',
  }]);
});

test('does not present an unresolved record as a resolved synonym relationship', () => {
  assert.deepEqual(buildSynonymRelationships(
    [{ taxonid: 1, taxonname: 'Unresolved name' }],
    () => null,
  ), []);
});
