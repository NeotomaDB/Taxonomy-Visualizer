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
}) {
  if (!isStewardView()) return false;

  const selectionPanel = document.getElementById('info');
  const dataPanel = document.getElementById('steward-taxon-detail');
  if (!selectionPanel || !dataPanel || taxonId == null) return true;

  const pathNames = Array.isArray(names) ? names.filter(Boolean) : [];
  const selectedName = pathNames.at(-1) || `Taxon ${taxonId}`;

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
