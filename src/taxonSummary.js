const summaryCache = new Map();
const summaryPromiseCache = new Map();
let summaryIndexCache = null;
let summaryIndexPromise = null;

const EXPLORER_BASE_URL = 'https://apps.neotomadb.org/explorer/';
const OCCURRENCE_SUMMARY_INDEX_URL = 'data/terminal_nodes_datasetids/index.json';
const FALLBACK_OCCURRENCE_SUMMARY_FILES_BY_GROUP = {
  ACR: 'ACR_Acritarchs.json',
};

function toPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildExplorerUrl(datasetids) {
  const ids = Array.isArray(datasetids)
    ? datasetids.map(toPositiveNumber).filter(Number.isFinite)
    : [];
  if (!ids.length) return null;
  return `${EXPLORER_BASE_URL}?datasetids=${ids.join(',')}`;
}

function normalizeTaxagroupid(taxagroupid) {
  return String(taxagroupid || '').trim().toUpperCase();
}

export function isOccurrenceSummaryEnabled(taxagroupid) {
  return Boolean(normalizeTaxagroupid(taxagroupid));
}

function normalizeSummaryIndex(payload) {
  const groups = payload && typeof payload === 'object' ? payload.groups : null;
  if (!groups || typeof groups !== 'object') return {};

  return Object.fromEntries(
    Object.entries(groups)
      .map(([groupId, entry]) => {
        const normalizedGroupId = normalizeTaxagroupid(groupId);
        const filename = typeof entry === 'string' ? entry : entry?.file;
        return normalizedGroupId && filename ? [normalizedGroupId, filename] : null;
      })
      .filter(Boolean),
  );
}

async function loadSummaryIndex() {
  if (summaryIndexCache) return summaryIndexCache;
  if (summaryIndexPromise) return summaryIndexPromise;

  summaryIndexPromise = fetch(OCCURRENCE_SUMMARY_INDEX_URL, { cache: 'default' })
    .then(response => {
      if (!response.ok) return {};
      return response.json();
    })
    .then(payload => {
      summaryIndexCache = normalizeSummaryIndex(payload);
      return summaryIndexCache;
    })
    .catch(error => {
      console.warn('Could not load taxon summary index:', error);
      summaryIndexCache = { ...FALLBACK_OCCURRENCE_SUMMARY_FILES_BY_GROUP };
      return summaryIndexCache;
    })
    .finally(() => {
      summaryIndexPromise = null;
    });

  return summaryIndexPromise;
}

export function normalizeTaxonOccurrenceRecord(record) {
  if (!Array.isArray(record)) return null;
  const [occurrenceCountValue, siteCountValue, datasetidsValue] = record;
  const datasetids = Array.isArray(datasetidsValue)
    ? datasetidsValue.map(toPositiveNumber).filter(Number.isFinite)
    : [];
  const occurrenceCount = Number(occurrenceCountValue || 0);
  if (!occurrenceCount || !datasetids.length) return null;

  return {
    occurrenceCount,
    siteCount: Number(siteCountValue || 0),
    datasetCount: datasetids.length,
    datasetids,
  };
}

async function loadTaxonSummary(taxagroupid) {
  const groupId = normalizeTaxagroupid(taxagroupid);
  if (!groupId) return null;
  if (summaryCache.has(groupId)) return summaryCache.get(groupId);
  if (summaryPromiseCache.has(groupId)) return summaryPromiseCache.get(groupId);

  const summaryIndex = await loadSummaryIndex();
  const filename = summaryIndex[groupId];
  if (!filename) {
    summaryCache.set(groupId, null);
    return null;
  }

  const promise = fetch(`data/terminal_nodes_datasetids/${filename}`, { cache: 'default' })
    .then(response => {
      if (!response.ok) return null;
      return response.json();
    })
    .then(payload => {
      summaryCache.set(groupId, payload);
      return payload;
    })
    .catch(error => {
      console.warn(`Could not load taxon summary for ${groupId}:`, error);
      summaryCache.set(groupId, null);
      return null;
    })
    .finally(() => {
      summaryPromiseCache.delete(groupId);
    });

  summaryPromiseCache.set(groupId, promise);
  return promise;
}

export function getTaxonSummaryRecord(payload, taxonId) {
  if (!payload || !payload.taxa || taxonId == null) return null;
  const record = payload.taxa[String(taxonId)];
  return normalizeTaxonOccurrenceRecord(record);
}

export async function fetchTaxonSummaryRecord(taxonId, taxagroupid) {
  const payload = await loadTaxonSummary(taxagroupid);
  return getTaxonSummaryRecord(payload, taxonId);
}

export function renderTaxonSummary(record) {
  if (!record || !record.datasetids.length) return '';
  const explorerUrl = buildExplorerUrl(record.datasetids);
  if (!explorerUrl) return '';

  return `
    <div style="
      margin-top:12px;
      padding:10px 12px;
      background:#f8fafc;
      border:1px solid #dbeafe;
      border-radius:8px;
      font-size:12px;
      color:#334155;
    ">
      <div style="font-weight:700;color:#1d4ed8;margin-bottom:6px;">Neotoma occurrence records</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:9px;">
        <span><strong>${record.occurrenceCount}</strong> occurrences</span>
        <span><strong>${record.siteCount}</strong> sites</span>
        <span><strong>${record.datasetCount}</strong> datasets</span>
      </div>
      <a href="${escapeHtml(explorerUrl)}" target="_blank" rel="noopener noreferrer" style="
        display:inline-flex;
        align-items:center;
        gap:6px;
        padding:7px 11px;
        background:#2563eb;
        color:#fff;
        text-decoration:none;
        border-radius:7px;
        font-size:13px;
        font-weight:700;
      " onmouseover="this.style.background='#1d4ed8'" onmouseout="this.style.background='#2563eb'">
        See in Explorer
      </a>
    </div>
  `;
}

export async function fetchAndRenderTaxonSummary(
  taxonId,
  taxagroupid,
  containerElement,
  currentClickIdRef,
) {
  if (!containerElement || taxonId == null || !taxagroupid) return;
  containerElement.innerHTML = '';

  if (!isOccurrenceSummaryEnabled(taxagroupid)) return;

  const payload = await loadTaxonSummary(taxagroupid);
  if (currentClickIdRef && String(currentClickIdRef.value) !== String(taxonId)) return;

  const record = getTaxonSummaryRecord(payload, taxonId);
  containerElement.innerHTML = renderTaxonSummary(record);
}
