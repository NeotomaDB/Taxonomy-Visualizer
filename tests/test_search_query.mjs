import assert from 'node:assert/strict';
import test from 'node:test';

import { splitSearchQuery, unwrapQuotedSearchTerm } from '../src/searchQuery.js';

test('keeps a normal name or TaxonID as one search term', () => {
  assert.deepEqual(splitSearchQuery('Mammalia'), ['Mammalia']);
  assert.deepEqual(splitSearchQuery('  6171  '), ['6171']);
});

test('splits two unquoted taxa for comparison', () => {
  assert.deepEqual(splitSearchQuery('Mammalia, Aves'), ['Mammalia', 'Aves']);
});

test('preserves commas inside one quoted taxon name', () => {
  const name = '24-methylcholest-5,22-dien-3β-ol';
  assert.deepEqual(splitSearchQuery(`"${name}"`), [`"${name}"`]);
  assert.equal(unwrapQuotedSearchTerm(`"${name}"`), name);
});

test('supports comparison when either quoted taxon contains commas', () => {
  assert.deepEqual(
    splitSearchQuery('"Taxon, one", "Taxon, two"'),
    ['"Taxon, one"', '"Taxon, two"'],
  );
});

test('supports single quotes and escaped quote characters', () => {
  assert.deepEqual(splitSearchQuery("'Taxon, one'"), ["'Taxon, one'"]);
  assert.equal(unwrapQuotedSearchTerm("'Taxon, one'"), 'Taxon, one');
  assert.deepEqual(splitSearchQuery('"Taxon \\"A\\", one"'), ['"Taxon \\"A\\", one"']);
  assert.equal(unwrapQuotedSearchTerm('"Taxon \\"A\\", one"'), 'Taxon "A", one');
});

test('ignores empty comma-separated segments', () => {
  assert.deepEqual(splitSearchQuery(' , Mammalia, , Aves, '), ['Mammalia', 'Aves']);
  assert.deepEqual(splitSearchQuery(''), []);
});

