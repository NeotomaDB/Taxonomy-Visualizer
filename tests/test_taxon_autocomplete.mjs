import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTaxonAutocompleteCandidates,
  getTaxonAutocompleteSuggestions,
} from '../src/taxonAutocomplete.js';

function makeRoot(nodes) {
  return { data: { id: 0, name: 'Root' }, children: nodes };
}

const candidates = buildTaxonAutocompleteCandidates(makeRoot([
  { data: { id: 1, name: 'Mammalia' } },
  { data: { id: 2, name: 'Aves' } },
  {
    data: {
      id: 3,
      name: 'Mecsekia ariakense',
      synonymMetadata: { synonyms: [{ invalid_name: 'Micrhystridium ariakense' }] },
    },
  },
]));

test('suggests an exact canonical taxon for a partial name', () => {
  assert.equal(getTaxonAutocompleteSuggestions(candidates, 'mamm')[0].canonicalName, 'Mammalia');
});

test('suggests a canonical taxon for a small spelling error', () => {
  assert.equal(getTaxonAutocompleteSuggestions(candidates, 'mammallia')[0].canonicalName, 'Mammalia');
});

test('suggests the accepted taxon when a synonym is typed', () => {
  const suggestion = getTaxonAutocompleteSuggestions(candidates, 'micrhystridium')[0];
  assert.equal(suggestion.canonicalName, 'Mecsekia ariakense');
  assert.equal(suggestion.isSynonym, true);
});

test('does not make noisy one-character suggestions', () => {
  assert.deepEqual(getTaxonAutocompleteSuggestions(candidates, 'm'), []);
});

test('includes taxa hidden in a collapsed subtree', () => {
  const collapsedCandidates = buildTaxonAutocompleteCandidates({
    data: { id: 0, name: 'Root' },
    _children: [{ data: { id: 4, name: 'Bison bison' } }],
  });

  assert.equal(getTaxonAutocompleteSuggestions(collapsedCandidates, 'bi')[0].canonicalName, 'Bison bison');
});
