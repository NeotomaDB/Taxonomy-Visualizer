const API_BASE = 'https://api.neotomadb.org/v2.0';
const PAGE_SIZE = 10000;

let taxaIndex = null;
let taxaIndexPromise = null;
let contactsIndex = null;
let contactsIndexPromise = null;

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

function formatContactName(contact) {
  if (!contact) return null;
  if (contact.contactname) return String(contact.contactname).trim();
  const parts = [contact.givennames, contact.familyname].filter(Boolean);
  return parts.length ? parts.join(' ').trim() : null;
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload?.data && Array.isArray(payload.data)) return payload.data;
  return [];
}

async function paginateTable(table, onPage) {
  let offset = 0;
  while (true) {
    const response = await fetch(
      `${API_BASE}/data/dbtables/${table}?limit=${PAGE_SIZE}&offset=${offset}`,
      { cache: 'default' }
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch ${table} (HTTP ${response.status})`);
    }
    const rows = extractRows(await response.json());
    if (!rows.length) break;
    onPage(rows);
    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }
}

async function ensureTaxaIndex() {
  if (taxaIndex) return taxaIndex;
  if (!taxaIndexPromise) {
    taxaIndexPromise = (async () => {
      const map = new Map();
      await paginateTable('taxa', (rows) => {
        rows.forEach((row) => {
          const taxonId = Number(row.taxonid);
          if (!Number.isFinite(taxonId)) return;
          map.set(taxonId, {
            validatorid: row.validatorid != null ? Number(row.validatorid) : null,
            validatedate: row.validatedate || null,
          });
        });
      });
      taxaIndex = map;
    })().catch((err) => {
      taxaIndexPromise = null;
      throw err;
    });
  }
  await taxaIndexPromise;
  return taxaIndex;
}

async function ensureContactsIndex() {
  if (contactsIndex) return contactsIndex;
  if (!contactsIndexPromise) {
    contactsIndexPromise = (async () => {
      const map = new Map();
      await paginateTable('contacts', (rows) => {
        rows.forEach((row) => {
          const contactId = Number(row.contactid);
          if (!Number.isFinite(contactId)) return;
          map.set(contactId, row);
        });
      });
      contactsIndex = map;
    })().catch((err) => {
      contactsIndexPromise = null;
      throw err;
    });
  }
  await contactsIndexPromise;
  return contactsIndex;
}

async function fetchTaxonFromApi(taxonId) {
  const numericId = Number(taxonId);
  let response = await fetch(`${API_BASE}/data/taxa/${numericId}`, { cache: 'no-store' });
  if (!response.ok) {
    response = await fetch(`${API_BASE}/data/taxa?taxonid=${numericId}`, { cache: 'no-store' });
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch taxon ${numericId} (HTTP ${response.status})`);
  }
  const rows = extractRows(await response.json());
  const row = rows.find((item) => Number(item.taxonid) === numericId) || rows[0];
  if (!row) {
    throw new Error(`Taxon ${numericId} not found`);
  }
  return row;
}

async function resolveValidatorName(validatorId) {
  if (validatorId == null || !Number.isFinite(validatorId)) return null;
  const contacts = await ensureContactsIndex();
  return formatContactName(contacts.get(validatorId));
}

export async function fetchTaxonMetadata(taxonId) {
  const numericId = Number(taxonId);
  if (!Number.isFinite(numericId)) {
    throw new Error('Invalid taxon id');
  }

  const [taxonRow, taxaMap] = await Promise.all([
    fetchTaxonFromApi(numericId),
    ensureTaxaIndex().catch(() => null),
  ]);

  const indexRow = taxaMap?.get(numericId) || {};
  const validatorId = indexRow.validatorid ?? null;
  const validatedate = indexRow.validatedate ?? null;
  const validatorName = validatorId != null
    ? await resolveValidatorName(validatorId).catch(() => null)
    : null;

  return {
    taxonid: numericId,
    author: taxonRow.author || null,
    publicationid: taxonRow.publicationid != null ? Number(taxonRow.publicationid) : null,
    publication: taxonRow.publication || null,
    validatorid: validatorId,
    validatorName,
    validatedate,
  };
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
    console.error('Failed to load taxon metadata:', err);
    if (currentClickIdRef && Number(currentClickIdRef.value) !== requestedId) {
      return;
    }
    containerElement.innerHTML = `
      <div style="margin:12px 0 0 12px;font-size:12px;color:#b91c1c;">
        Could not load taxon metadata from Neotoma API.
      </div>
    `;
  }
}
