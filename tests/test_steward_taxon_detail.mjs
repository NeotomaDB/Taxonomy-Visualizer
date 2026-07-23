import assert from 'node:assert/strict';
import test from 'node:test';

import { buildStewardSynonymPanelHtml } from '../src/stewardTaxonDetail.js';

test('matches the Explorer resolution panel except for its disclaimer', () => {
  const html = buildStewardSynonymPanelHtml({
    taxonId: 44439,
    selectedName: 'Dermanura phaeotis',
    matchedDirectly: false,
    synonymResolutions: [{
      invalidId: 44440,
      invalidName: 'Artibeus phaeotis',
      synonymtype: 'nomenclatural synonym',
      recdatemodified: '2021-06-17T20:02:20.000Z',
    }],
  });

  assert.match(html, /steward-synonym-panel--resolution/);
  assert.match(html, /<strong>Accepted name in Neotoma:<\/strong> <span>Dermanura phaeotis \(ID 44439\)<\/span>/);
  assert.match(html, /<strong>Synonym:<\/strong>/);
  assert.match(html, /<em>Artibeus phaeotis \(ID 44440\)<\/em>/);
  assert.match(html, /<strong>Type:<\/strong> nomenclatural synonym[\s\S]* · [\s\S]*<strong>Updated:<\/strong> June 1[78], 2021/);
  assert.doesNotMatch(html, /Synonym status shown here/);
});

test('matches the Explorer accepted-name synonym panel except for its disclaimer', () => {
  const html = buildStewardSynonymPanelHtml({
    taxonId: 44439,
    selectedName: 'Dermanura phaeotis',
    matchedDirectly: true,
    synonymInfo: {
      synonyms: [{
        invalid_id: 44440,
        invalid_name: 'Artibeus phaeotis',
        synonymtype: 'nomenclatural synonym',
        recdatemodified: '2021-06-17T20:02:20.000Z',
      }],
    },
  });

  assert.doesNotMatch(html, /steward-synonym-panel--resolution/);
  assert.match(html, /<strong>Accepted name in Neotoma:<\/strong> <span>Dermanura phaeotis \(ID 44439\)<\/span>/);
  assert.match(html, /<strong>Synonym:<\/strong>/);
  assert.match(html, /<em>Artibeus phaeotis \(ID 44440\)<\/em>/);
  assert.match(html, /<strong>Type:<\/strong> nomenclatural synonym[\s\S]* · [\s\S]*<strong>Updated:<\/strong> June 1[78], 2021/);
  assert.doesNotMatch(html, /Synonym status shown here/);
});

test('omits the synonym panel for a taxon without synonym relationships', () => {
  assert.equal(buildStewardSynonymPanelHtml({
    taxonId: 1,
    selectedName: 'Clean taxon',
  }), '');
});
