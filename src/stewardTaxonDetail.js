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
 * In Data Steward view, keep selection identity and placement in the right
 * panel, while placing data-heavy metadata and occurrence cards below the
 * primary canvas. Returns false outside that view so Explorer is unchanged.
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
    <div class="steward-detail-cards">
      <section class="steward-detail-card" aria-labelledby="steward-metadata-heading">
        <h2 id="steward-metadata-heading">Metadata</h2>
        <div id="steward-taxon-metadata"></div>
      </section>
      <section class="steward-detail-card" aria-labelledby="steward-occurrence-heading">
        <h2 id="steward-occurrence-heading">Neotoma Occurrence Records</h2>
        <div id="steward-taxon-summary"></div>
      </section>
    </div>
  `;
  dataPanel.hidden = false;

  const metadataContainer = dataPanel.querySelector('#steward-taxon-metadata');
  if (metadataContainer) {
    fetchAndRenderTaxonMetadata(taxonId, metadataContainer, currentClickIdRef, { framed: false });
  }

  const summaryContainer = dataPanel.querySelector('#steward-taxon-summary');
  if (summaryContainer) {
    fetchAndRenderTaxonSummary(taxonId, taxagroupid, summaryContainer, currentClickIdRef, {
      showHeading: false,
      framed: false,
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
