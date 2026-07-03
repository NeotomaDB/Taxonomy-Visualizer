import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCitationDisplayValue,
  fetchPublicationDetails,
  renderTaxonMetadataHtml,
} from '../src/taxonMetadata.js';

test('prefers publication citation when available', () => {
  assert.equal(
    buildCitationDisplayValue({
      author: 'Miller, 1754',
      publicationYear: '1991',
      citation: 'Gajewski, K. 1991. Example citation.',
    }),
    'Gajewski, K. 1991. Example citation.',
  );
});

test('falls back to publication text before author-year formatting', () => {
  assert.equal(
    buildCitationDisplayValue({
      author: 'Eisenack, 1958, emend. Downie & Sargent, 1963, Turner, 1984',
      publication: 'Williams, G.L., R.A. Fensome, and R.A. MacRae. 2017. The Lentin and Williams index of fossil Dinoflagellates 2017 edition. AASP Contribution Series 48. American Association of Stratigraphic Palynologists Foundation.',
      citation: null,
      publicationYear: null,
    }),
    'Williams, G.L., R.A. Fensome, and R.A. MacRae. 2017. The Lentin and Williams index of fossil Dinoflagellates 2017 edition. AASP Contribution Series 48. American Association of Stratigraphic Palynologists Foundation.',
  );
});

test('falls back to author and publication year without duplicating an embedded year', () => {
  assert.equal(
    buildCitationDisplayValue({
      author: 'Linnaeus',
      publicationYear: '1753',
      citation: null,
    }),
    'Linnaeus, 1753',
  );

  assert.equal(
    buildCitationDisplayValue({
      author: 'Miller, 1754',
      publicationYear: '1754',
      citation: null,
    }),
    'Miller, 1754',
  );
});

test('renders citation first and merges validation details into one line', () => {
  const html = renderTaxonMetadataHtml({
    validatorName: 'Test Validator',
    validatorid: 44,
    validatedate: '2017-04-21T00:00:00.000Z',
    citation: 'Gajewski, K. 1991. Example citation.',
  });

  assert.match(html, /Citation/);
  assert.match(html, /Gajewski, K\. 1991\. Example citation\./);
  assert.match(html, /Validation/);
  assert.match(html, /Test Validator, April 21, 2017/);
  assert.doesNotMatch(html, /Publication ID/);
  assert.doesNotMatch(html, /Publication<\/dt>/);
  assert.doesNotMatch(html, /Author/);
  assert.doesNotMatch(html, /Validator<\/dt>/);
  assert.doesNotMatch(html, /Validated<\/dt>/);
  assert.doesNotMatch(html, /\(ID 44\)/);
  assert.ok(html.indexOf('Citation') < html.indexOf('Validation'));
});

test('loads a single publication citation by publication id', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      async json() {
        return {
          status: 'success',
          data: [
            {
              publication: {
                publicationid: 299,
                year: '1993',
                citation: 'Flora of North America Editorial Committee. 1993. Example citation.',
              },
            },
          ],
        };
      },
    };
  };

  try {
    assert.deepEqual(await fetchPublicationDetails(299), {
      citation: 'Flora of North America Editorial Committee. 1993. Example citation.',
      publicationYear: '1993',
    });
    assert.deepEqual(calls, [
      'https://api.neotomadb.org/v2.0/data/publications/299',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
