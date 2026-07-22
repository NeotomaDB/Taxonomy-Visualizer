function formatDateLabel(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCompactDateLabel(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'\"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[character]));
}

function getSummaryDateLabel(item) {
  if (item._kind === 'new') {
    return `Created ${formatDateLabel(item.recdatecreated)}`;
  }
  return `Modified ${formatDateLabel(item.recdatemodified || item.recdatecreated)}`;
}

function badgeStyles(kind) {
  if (kind === 'new') {
    return {
      text: 'New',
      bg: '#dcfce7',
      fg: '#166534',
      border: '#86efac',
    };
  }
  return {
    text: 'Modified',
    bg: '#fef3c7',
    fg: '#92400e',
    border: '#fcd34d',
  };
}

function flattenSummary(summaryData) {
  const created = (summaryData?.new || []).map(item => ({ ...item, _kind: 'new' }));
  const modified = (summaryData?.modified || []).map(item => ({ ...item, _kind: 'modified' }));
  return [...created, ...modified].sort((a, b) => {
    const aDate = new Date(a.recdatemodified || a.recdatecreated || 0).getTime();
    const bDate = new Date(b.recdatemodified || b.recdatecreated || 0).getTime();
    return bDate - aDate;
  });
}

async function navigateToSummaryItem(item) {
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  if (!searchInput || !searchBtn) return;

  if (item.taxagroupid && typeof window.loadTreeForGroup === 'function') {
    await window.loadTreeForGroup(item.taxagroupid, false);
  }

  searchInput.value = item.taxonname || String(item.taxonid);
  searchBtn.click();
}

const MAX_RANGE_DAYS = 30;

const RANGE_OPTIONS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last Month' },
];

function getRangeLabel(days) {
  return RANGE_OPTIONS.find(option => option.days === days)?.label ?? `Last ${days} days`;
}

function getDataCoverageDays(summaryData) {
  if (!summaryData?.since || !summaryData?.generated_at) return null;
  const since = new Date(summaryData.since);
  const generated = new Date(summaryData.generated_at);
  if (Number.isNaN(since.getTime()) || Number.isNaN(generated.getTime())) return null;
  return Math.round((generated.getTime() - since.getTime()) / (24 * 60 * 60 * 1000));
}

let currentSummaryData = null;
let currentSummaryTaxagroupid = null;
let currentTaxagroupNames = {};
let currentRangeDays = 14;
let currentSummaryPage = 1;

const SUMMARY_PAGE_SIZE = 20;

export function updateSummaryPanel(summaryData, currentTaxagroupid, taxagroupNames) {
  if (summaryData !== undefined && summaryData !== currentSummaryData) {
    currentSummaryData = summaryData;
    currentSummaryPage = 1;
  }
  if (currentTaxagroupid !== undefined && currentTaxagroupid !== currentSummaryTaxagroupid) {
    currentSummaryTaxagroupid = currentTaxagroupid;
    currentSummaryPage = 1;
  }
  if (taxagroupNames !== undefined) currentTaxagroupNames = taxagroupNames;

  const dataToRender = currentSummaryData;
  const panel = document.getElementById('summary-panel');
  if (!panel) return;

  if (!dataToRender) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  if (currentRangeDays > MAX_RANGE_DAYS) {
    currentRangeDays = 14;
  }

  const allEntries = flattenSummary(dataToRender);
  
  const referenceDate = dataToRender.generated_at ? new Date(dataToRender.generated_at) : new Date();
  const cutoffTime = referenceDate.getTime() - (currentRangeDays * 24 * 60 * 60 * 1000);
  
  const timeFilteredEntries = allEntries.filter(item => {
    const itemDateStr = item.recdatemodified || item.recdatecreated;
    if (!itemDateStr) return false;
    const itemTime = new Date(itemDateStr).getTime();
    return itemTime >= cutoffTime;
  });

  const filteredEntries = currentSummaryTaxagroupid
    ? timeFilteredEntries.filter(item => item.taxagroupid === currentSummaryTaxagroupid)
    : timeFilteredEntries;
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / SUMMARY_PAGE_SIZE));
  if (currentSummaryPage > totalPages) {
    currentSummaryPage = totalPages;
  }
  const startIndex = (currentSummaryPage - 1) * SUMMARY_PAGE_SIZE;
  const endIndex = startIndex + SUMMARY_PAGE_SIZE;
  const visibleEntries = filteredEntries.slice(startIndex, endIndex);

  const currentGroupName = currentSummaryTaxagroupid
    ? (currentTaxagroupNames[currentSummaryTaxagroupid] || currentSummaryTaxagroupid)
    : 'All Groups';

  const newCount = filteredEntries.filter(item => item._kind === 'new').length;
  const modifiedCount = filteredEntries.filter(item => item._kind === 'modified').length;
  const dataCoverageDays = getDataCoverageDays(dataToRender);
  const coverageNote = dataCoverageDays != null && currentRangeDays > dataCoverageDays
    ? ` · Data covers ~${dataCoverageDays} days (refresh to load more)`
    : '';

  const rowsHtml = visibleEntries.length > 0
      ? visibleEntries.map(item => {
        const badge = badgeStyles(item._kind);
        const groupLabel = item.taxagroupid
          ? (currentTaxagroupNames[item.taxagroupid] || item.taxagroupid)
          : 'Unknown group';
        const itemDate = item.recdatemodified || item.recdatecreated;
        const changedFields = item.changed_fields?.length
          ? `<span class="summary-change-count" title="Changed: ${escapeHtml(item.changed_fields.join(', '))}">
              ${item.changed_fields.length} field${item.changed_fields.length === 1 ? '' : 's'}
            </span>`
          : '';
        return `
          <div class="summary-item" role="listitem">
            <span class="summary-kind summary-kind--${item._kind}" style="--summary-badge-bg:${badge.bg};--summary-badge-fg:${badge.fg};--summary-badge-border:${badge.border};">
              ${badge.text}
            </span>
            <div class="summary-item-main">
              <span class="summary-taxon-name" title="${escapeHtml(item.taxonname)}">${escapeHtml(item.taxonname)}</span>
              <span class="summary-item-details">
                <span class="summary-group" title="${escapeHtml(groupLabel)}">${escapeHtml(groupLabel)}</span>
                <span aria-hidden="true">·</span>
                <span>#${escapeHtml(item.taxonid)}</span>
                <span aria-hidden="true">·</span>
                <time datetime="${escapeHtml(itemDate)}" title="${escapeHtml(getSummaryDateLabel(item))}">${formatCompactDateLabel(itemDate)}</time>
                ${changedFields}
              </span>
            </div>
            <button
              class="summary-search-btn"
              data-taxonid="${item.taxonid}"
              aria-label="View ${escapeHtml(item.taxonname)}"
              title="View in taxonomy"
            ><span aria-hidden="true">↗</span></button>
          </div>
        `;
      }).join('')
    : `
      <div class="summary-empty-state">
        No new or modified taxa in the current summary window for ${escapeHtml(currentGroupName)}.
      </div>
    `;

  panel.innerHTML = `
    <div class="summary-panel-header">
      <div>
        <div class="summary-panel-title">Recent changes</div>
        <div class="summary-panel-subtitle">Refreshed ${formatDateLabel(dataToRender.generated_at)} · Scope: ${escapeHtml(currentGroupName)}${coverageNote}</div>
      </div>
      <select id="summary-range-select" class="summary-range-select" aria-label="Change time range">
        ${RANGE_OPTIONS.map(option => `
          <option value="${option.days}" ${currentRangeDays === option.days ? 'selected' : ''}>${option.label}</option>
        `).join('')}
      </select>
    </div>
    <div class="summary-stats" aria-label="Change counts for ${getRangeLabel(currentRangeDays)}">
      <span class="summary-stat summary-stat--total">
        ${filteredEntries.length} total
      </span>
      <span class="summary-stat summary-stat--new">
        ${newCount} new
      </span>
      <span class="summary-stat summary-stat--modified">
        ${modifiedCount} modified
      </span>
    </div>
    <div class="summary-pagination">
      <div class="summary-pagination-copy">
        ${filteredEntries.length === 0
          ? `No items in ${getRangeLabel(currentRangeDays)}`
          : `Page ${currentSummaryPage} of ${totalPages} · ${filteredEntries.length} items in ${getRangeLabel(currentRangeDays)}`}
      </div>
      <div class="summary-pagination-actions">
        <button
          id="summary-prev-page"
          ${currentSummaryPage <= 1 ? 'disabled' : ''}
        >Previous</button>
        <button
          id="summary-next-page"
          ${currentSummaryPage >= totalPages ? 'disabled' : ''}
        >Next</button>
      </div>
    </div>
    <div class="summary-items" role="list">${rowsHtml}</div>
  `;
  panel.style.display = 'block';

  const selectEl = panel.querySelector('#summary-range-select');
  if (selectEl) {
    selectEl.addEventListener('change', (e) => {
      currentRangeDays = parseInt(e.target.value, 10);
      currentSummaryPage = 1;
      updateSummaryPanel();
    });
  }

  const prevBtn = panel.querySelector('#summary-prev-page');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentSummaryPage <= 1) return;
      currentSummaryPage -= 1;
      updateSummaryPanel();
    });
  }

  const nextBtn = panel.querySelector('#summary-next-page');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (currentSummaryPage >= totalPages) return;
      currentSummaryPage += 1;
      updateSummaryPanel();
    });
  }

  panel.querySelectorAll('.summary-search-btn').forEach(button => {
    button.addEventListener('click', async () => {
      const taxonId = Number(button.getAttribute('data-taxonid'));
      const selected = visibleEntries.find(item => item.taxonid === taxonId);
      if (selected) {
        await navigateToSummaryItem(selected);
      }
    });
  });
}
