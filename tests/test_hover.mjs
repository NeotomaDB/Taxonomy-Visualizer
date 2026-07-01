import assert from 'node:assert/strict';
import test from 'node:test';

import { renderHoverTaxonInfo } from '../src/hover.js';

test('renders plain hover label when no occurrence record exists', () => {
  assert.equal(renderHoverTaxonInfo('<Acritarch>'), '&lt;Acritarch&gt;');
});

test('renders occurrence and dataset counts in hover label', () => {
  const html = renderHoverTaxonInfo('Acritarch sp. A', {
    occurrenceCount: 64,
    datasetCount: 3,
    siteCount: 3,
  });

  assert.match(html, /Acritarch sp\. A/);
  assert.match(html, /64 occurrences/);
  assert.match(html, /3 datasets/);
  assert.match(html, /3 sites/);
});
