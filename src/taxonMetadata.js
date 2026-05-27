let metadataIndex = null;
let metadataIndexPromise = null;

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
  return metadata;
}

export function renderTaxonMetadataHtml(metadata) {
  if (!metadata) return '';

  const author = metadata.author
    ? escapeHtml(metadata.author)
    : '<span style="color:#9ca3af;font-style:italic;">Not recorded</span>';

  const validator = metadata.validatorName
    ? `${escapeHtml(metadata.validatorName)} <span style="color:#9ca3af;">(ID ${metadata.validatorid})</span>`
    : metadata.validatorid != null
      ? `<span style="color:#9ca3af;">Contact ID ${metadata.validatorid}</span>`
      : '<span style="color:#9ca3af;font-style:italic;">Not recorded</span>';

  const validated = metadata.validatedate
    ? escapeHtml(formatDateLabel(metadata.validatedate))
    : '<span style="color:#9ca3af;font-style:italic;">—</span>';

  const publicationId = metadata.publicationid != null
    ? escapeHtml(metadata.publicationid)
    : '<span style="color:#9ca3af;font-style:italic;">—</span>';

  const publication = metadata.publication
    ? escapeHtml(metadata.publication)
    : '<span style="color:#9ca3af;font-style:italic;">Not recorded</span>';

  return `
    <dl style="
      margin:12px 0 0 12px;padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;
      border-radius:8px;font-size:12px;line-height:1.55;
    ">
      <dt style="font-weight:600;color:#6b7280;float:left;clear:left;width:108px;margin:0 0 4px 0;">Author</dt>
      <dd style="margin:0 0 8px 108px;color:#374151;">${author}</dd>
      <dt style="font-weight:600;color:#6b7280;float:left;clear:left;width:108px;margin:0 0 4px 0;">Validator</dt>
      <dd style="margin:0 0 8px 108px;color:#374151;">${validator}</dd>
      <dt style="font-weight:600;color:#6b7280;float:left;clear:left;width:108px;margin:0 0 4px 0;">Validated</dt>
      <dd style="margin:0 0 8px 108px;color:#374151;">${validated}</dd>
      <dt style="font-weight:600;color:#6b7280;float:left;clear:left;width:108px;margin:0 0 4px 0;">Publication ID</dt>
      <dd style="margin:0 0 8px 108px;color:#374151;">${publicationId}</dd>
      <dt style="font-weight:600;color:#6b7280;float:left;clear:left;width:108px;margin:0 0 4px 0;">Publication</dt>
      <dd style="margin:0 0 2px 108px;color:#374151;word-break:break-word;">${publication}</dd>
    </dl>
  `;
}

export async function fetchAndRenderTaxonMetadata(taxonId, containerElement, currentClickIdRef) {
  if (!containerElement || taxonId == null) return;

  const requestedId = Number(taxonId);
  containerElement.innerHTML = `
    <div style="margin:12px 0 0 12px;font-size:12px;color:#888;font-style:italic;">
      Loading taxon metadata…
    </div>
  `;

  try {
    const metadata = await fetchTaxonMetadata(requestedId);
    if (currentClickIdRef && Number(currentClickIdRef.value) !== requestedId) {
      return;
    }
    containerElement.innerHTML = renderTaxonMetadataHtml(metadata);
  } catch (err) {
    console.error('Failed to load local taxon metadata:', err);
    if (currentClickIdRef && Number(currentClickIdRef.value) !== requestedId) {
      return;
    }
    containerElement.innerHTML = `
      <div style="margin:12px 0 0 12px;font-size:12px;color:#b91c1c;">
        Could not load local taxon metadata.
      </div>
    `;
  }
}
