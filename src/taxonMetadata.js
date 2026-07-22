let metadataIndex = null;
let metadataIndexPromise = null;
const publicationDetailsCache = new Map();
const publicationDetailsPromiseCache = new Map();

function escapeHtml(value) {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function hasYear(text, year) {
  if (!text || !year) return false;
  return String(text).includes(String(year));
}

export function buildCitationDisplayValue(metadata) {
  if (!metadata) return null;

  if (metadata.citation) {
    return String(metadata.citation).trim() || null;
  }

  if (metadata.publication) {
    return String(metadata.publication).trim() || null;
  }

  const author = metadata.author ? String(metadata.author).trim() : '';
  const year = metadata.publicationYear ? String(metadata.publicationYear).trim() : '';

  if (author && year) {
    return hasYear(author, year) ? author : `${author}, ${year}`;
  }
  return author || year || null;
}

function extractPublicationDetails(payload) {
  const resultRow = payload?.data?.result?.[0];
  if (resultRow?.publication) {
    return resultRow.publication;
  }

  const directRow = payload?.data?.[0];
  if (directRow?.publication) {
    return directRow.publication;
  }

  return null;
}

async function ensureMetadataIndex() {
  if (metadataIndex) return metadataIndex;
  if (!metadataIndexPromise) {
    metadataIndexPromise = fetch('data/taxon_metadata.json', { cache: 'default' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch local taxon metadata (HTTP ${response.status})`);
        }
        const payload = await response.json();
        const map = new Map();
        Object.entries(payload || {}).forEach(([taxonId, row]) => {
          const numericId = Number(taxonId);
          if (!Number.isFinite(numericId) || !row) return;
          map.set(numericId, row);
        });
        metadataIndex = map;
        return metadataIndex;
      })
      .catch((err) => {
        metadataIndexPromise = null;
        throw err;
      });
  }
  return metadataIndexPromise;
}

export async function fetchPublicationDetails(publicationId) {
  const numericId = Number(publicationId);
  if (!Number.isFinite(numericId)) {
    return null;
  }

  if (publicationDetailsCache.has(numericId)) {
    return publicationDetailsCache.get(numericId);
  }

  if (!publicationDetailsPromiseCache.has(numericId)) {
    const promise = fetch(`https://api.neotomadb.org/v2.0/data/publications/${numericId}`, {
      cache: 'default',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to fetch publication ${numericId} (HTTP ${response.status})`);
        }
        const payload = await response.json();
        const publication = extractPublicationDetails(payload);
        const details = publication
          ? {
              citation: publication.citation || null,
              publicationYear: publication.year || null,
            }
          : null;
        publicationDetailsCache.set(numericId, details);
        publicationDetailsPromiseCache.delete(numericId);
        return details;
      })
      .catch((err) => {
        publicationDetailsPromiseCache.delete(numericId);
        throw err;
      });

    publicationDetailsPromiseCache.set(numericId, promise);
  }

  return publicationDetailsPromiseCache.get(numericId);
}

export async function fetchTaxonMetadata(taxonId) {
  const numericId = Number(taxonId);
  if (!Number.isFinite(numericId)) {
    throw new Error('Invalid taxon id');
  }

  const metadataMap = await ensureMetadataIndex();
  const metadata = metadataMap.get(numericId);
  if (!metadata) {
    throw new Error(`Taxon ${numericId} not found in local metadata index`);
  }

  if (!metadata.citation && metadata.publicationid != null) {
    try {
      const publicationDetails = await fetchPublicationDetails(metadata.publicationid);
      if (publicationDetails) {
        metadata.citation ??= publicationDetails.citation;
        metadata.publicationYear ??= publicationDetails.publicationYear;
      }
    } catch (err) {
      console.warn(`Failed to fetch publication details for ${metadata.publicationid}:`, err);
    }
  }

  return metadata;
}

export function renderTaxonMetadataHtml(metadata, { framed = true } = {}) {
  if (!metadata) return '';

  const citationValue = buildCitationDisplayValue(metadata);
  const citation = citationValue
    ? escapeHtml(citationValue)
    : '<span style="color:#9ca3af;font-style:italic;">Not recorded</span>';

  const validationParts = [];
  if (metadata.validatorName) {
    validationParts.push(escapeHtml(metadata.validatorName));
  }
  if (metadata.validatedate) {
    validationParts.push(escapeHtml(formatDateLabel(metadata.validatedate)));
  }
  const validation = validationParts.length > 0
    ? validationParts.join(', ')
    : '<span style="color:#9ca3af;font-style:italic;">Not recorded</span>';

  const surfaceStyle = framed
    ? 'margin:12px 0 0 0;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;'
    : 'margin:9px 0 0 0;padding:0;';

  return `
    <dl style="${surfaceStyle}font-size:12px;line-height:1.55;">
      <dt style="font-weight:600;color:#6b7280;float:left;clear:left;width:72px;margin:0 0 4px 0;">Citation</dt>
      <dd style="margin:0 0 8px 72px;color:#374151;word-break:break-word;">${citation}</dd>
      <dt style="font-weight:600;color:#6b7280;float:left;clear:left;width:72px;margin:0 0 4px 0;">Validation</dt>
      <dd style="margin:0 0 2px 72px;color:#374151;">${validation}</dd>
    </dl>
  `;
}

export async function fetchAndRenderTaxonMetadata(taxonId, containerElement, currentClickIdRef, renderOptions) {
  if (!containerElement || taxonId == null) return;

  const requestedId = Number(taxonId);
  containerElement.innerHTML = `
    <div style="margin:12px 0 0 0;font-size:12px;color:#888;font-style:italic;">
      Loading taxon metadata…
    </div>
  `;

  try {
    const metadata = await fetchTaxonMetadata(requestedId);
    if (currentClickIdRef && Number(currentClickIdRef.value) !== requestedId) {
      return;
    }
    containerElement.innerHTML = renderTaxonMetadataHtml(metadata, renderOptions);
  } catch (err) {
    console.error('Failed to load local taxon metadata:', err);
    if (currentClickIdRef && Number(currentClickIdRef.value) !== requestedId) {
      return;
    }
    containerElement.innerHTML = `
      <div style="margin:12px 0 0 0;font-size:12px;color:#b91c1c;">
        Could not load local taxon metadata.
      </div>
    `;
  }
}
