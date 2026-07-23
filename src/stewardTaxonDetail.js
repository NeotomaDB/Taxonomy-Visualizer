import { fetchAndRenderTaxonMetadata } from './taxonMetadata.js';
import { fetchAndRenderTaxonSummary } from './taxonSummary.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isStewardView() {
  return document.body?.dataset.appView === 'steward';
}

function buildBreadcrumbHtml(names) {
  return names.map((name, index) => {
    const isCurrentTaxon = index === names.length - 1;
    const separator = index === 0 ? '' : '<span class="steward-path-separator" aria-hidden="true">›</span>';
    const className = isCurrentTaxon ? 'steward-path-current' : 'steward-path-item';
    return `${separator}<span class="${className}">${escapeHtml(name)}</span>`;
  }).join('');
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function normalizeSynonyms(synonymInfo) {
  return Array.isArray(synonymInfo?.synonyms)
    ? synonymInfo.synonyms.filter((synonym) => synonym?.invalid_name)
    : [];
}

function buildSynonymEntryHtml(record, index, total) {
  const invalidName = record?.invalidName || record?.invalid_name;
  const invalidId = record?.invalidId ?? record?.invalid_id;
  if (!invalidName) return '';
  const invalidIdSuffix = invalidId == null ? '' : ` (ID ${escapeHtml(invalidId)})`;
  const synonymLabel = total > 1 ? `Synonym ${index + 1}` : 'Synonym';
  const type = record?.synonymtype || '';
  const updated = formatDate(record?.recdatemodified);
  const metadataHtml = type || updated
    ? `
      <div class="steward-synonym-line steward-synonym-line--meta">
        ${type ? `<strong>Type:</strong> ${escapeHtml(type)}` : ''}
        ${type && updated ? '<span aria-hidden="true"> · </span>' : ''}
        ${updated ? `<strong>Updated:</strong> ${escapeHtml(updated)}` : ''}
      </div>
    `
    : '';

  return `
    <div class="steward-synonym-entry">
      <div class="steward-synonym-line steward-synonym-line--name">
        <strong>${synonymLabel}:</strong> <em>${escapeHtml(invalidName)}${invalidIdSuffix}</em>
      </div>
      ${metadataHtml}
    </div>
  `;
}

export function buildStewardSynonymPanelHtml({
  taxonId = null,
  selectedName = '',
  synonymInfo = null,
  synonymResolutions = [],
  matchedDirectly = true,
} = {}) {
  const resolutions = Array.isArray(synonymResolutions)
    ? synonymResolutions.filter((resolution) => resolution?.invalidName)
    : [];
  const synonyms = normalizeSynonyms(synonymInfo);
  const displayedSynonyms = !matchedDirectly && resolutions.length > 0
    ? resolutions
    : synonyms;
  if (displayedSynonyms.length === 0) return '';
  const isResolution = !matchedDirectly && resolutions.length > 0;
  const acceptedIdSuffix = taxonId == null ? '' : ` (ID ${escapeHtml(taxonId)})`;
  const acceptedNameHtml = selectedName
    ? `
      <div class="steward-synonym-line steward-synonym-line--accepted">
        <strong>Accepted name in Neotoma:</strong> <span>${escapeHtml(selectedName)}${acceptedIdSuffix}</span>
      </div>
    `
    : '';

  return `
    <section class="steward-synonym-panel${isResolution ? ' steward-synonym-panel--resolution' : ''}" aria-label="Synonyms recorded in Neotoma">
      ${acceptedNameHtml}
      ${displayedSynonyms.map((record, index) => buildSynonymEntryHtml(
        record,
        index,
        displayedSynonyms.length,
      )).join('')}
    </section>
  `;
}

/**
 * In Data Steward view, keep the selection and its supporting information in
 * the right panel. Returns false outside that view so Explorer is unchanged.
 */
export function renderStewardTaxonDetail({
  taxonId,
  names,
  taxagroupid,
  currentClickIdRef,
  isTerminalTaxon = false,
  synonymInfo = null,
  synonymResolutions = [],
  matchedDirectly = true,
}) {
  if (!isStewardView()) {
    clearStewardTaxonDetail();
    return false;
  }

  const selectionPanel = document.getElementById('info');
  const dataPanel = document.getElementById('steward-taxon-detail');
  if (!selectionPanel || !dataPanel || taxonId == null) return true;

  const pathNames = Array.isArray(names) ? names.filter(Boolean) : [];
  const selectedName = pathNames.at(-1) || `Taxon ${taxonId}`;
  const synonymPanelHtml = buildStewardSynonymPanelHtml({
    taxonId,
    selectedName,
    synonymInfo,
    synonymResolutions,
    matchedDirectly,
  });

  selectionPanel.innerHTML = `
    <div class="steward-detail-heading">
      <span class="steward-detail-kicker">Selected taxon:</span>
      <span class="steward-detail-name">${escapeHtml(selectedName)}</span>
      <span class="steward-detail-id">(ID ${escapeHtml(taxonId)})</span>
    </div>
    <div class="steward-path-row" aria-label="Taxonomic path">
      <span class="steward-path-label">Path:</span>
      <div class="steward-path" title="${escapeHtml(pathNames.join(' › '))}">
        ${buildBreadcrumbHtml(pathNames)}
      </div>
    </div>
  `;
  selectionPanel.style.display = 'block';

  dataPanel.innerHTML = `
    <section class="steward-detail-group" aria-label="Taxon Details">
      <div class="steward-detail-header">
        <button
          id="steward-detail-toggle"
          class="steward-detail-toggle"
          type="button"
          aria-expanded="true"
          aria-controls="steward-detail-content"
          aria-label="Collapse Taxon Details"
          title="Collapse Taxon Details"
        ><span class="steward-detail-toggle-icon" aria-hidden="true">▾</span></button>
        <span class="steward-detail-title">Taxon Details</span>
      </div>
      <div class="steward-detail-content">
        <section class="steward-detail-card" aria-label="Taxon metadata">
          <div id="steward-taxon-metadata"></div>
        </section>
        ${synonymPanelHtml}
        <section class="steward-detail-card" aria-label="Neotoma occurrence records">
          <div id="steward-taxon-summary"></div>
        </section>
      </div>
    </section>
  `;
  dataPanel.hidden = false;

  const detailToggle = dataPanel.querySelector('#steward-detail-toggle');
  const detailContent = dataPanel.querySelector('.steward-detail-content');
  detailToggle?.addEventListener('click', () => {
    const nextExpanded = detailToggle.getAttribute('aria-expanded') !== 'true';
    detailToggle.setAttribute('aria-expanded', String(nextExpanded));
    detailToggle.setAttribute('aria-label', `${nextExpanded ? 'Collapse' : 'Expand'} Taxon Details`);
    detailToggle.title = `${nextExpanded ? 'Collapse' : 'Expand'} Taxon Details`;
    if (detailContent) detailContent.hidden = !nextExpanded;
  });

  const metadataContainer = dataPanel.querySelector('#steward-taxon-metadata');
  if (metadataContainer) {
    fetchAndRenderTaxonMetadata(taxonId, metadataContainer, currentClickIdRef);
  }

  const summaryContainer = dataPanel.querySelector('#steward-taxon-summary');
  if (summaryContainer) {
    fetchAndRenderTaxonSummary(taxonId, taxagroupid, summaryContainer, currentClickIdRef, {
      emptyMessage: isTerminalTaxon
        ? 'No occurrence records available for this taxon.'
        : 'Occurrence records are available for terminal taxon.',
    });
  }

  return true;
}

export function clearStewardTaxonDetail() {
  const dataPanel = document.getElementById('steward-taxon-detail');
  if (dataPanel) {
    dataPanel.hidden = true;
    dataPanel.innerHTML = '';
  }
}
