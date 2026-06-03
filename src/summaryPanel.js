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

function getSummaryHeaderRangeLabel(days) {
  return `${getRangeLabel(days)} from the most recent update`;
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
        const changedFields = item.changed_fields?.length
          ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">Changed: ${item.changed_fields.join(', ')}</div>`
          : '';
        return `
          <div class="summary-item" style="padding:10px 0;border-top:1px solid #e5e7eb;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
              <div style="min-width:0;flex:1;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <span style="
                    display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
                    background:${badge.bg};color:${badge.fg};border:1px solid ${badge.border};
                    font-size:11px;font-weight:700;
                  ">${badge.text}</span>
                  <span style="font-size:11px;color:#6b7280;">${groupLabel}</span>
                </div>
                <div style="font-weight:600;color:#1f2937;margin-top:6px;">${item.taxonname}</div>
                <div style="font-size:12px;color:#4b5563;margin-top:3px;">Taxon ID: ${item.taxonid}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:4px;line-height:1.45;">${getSummaryDateLabel(item)}</div>
                ${changedFields}
              </div>
              <button
                class="summary-search-btn"
                data-taxonid="${item.taxonid}"
                style="
                  flex-shrink:0;padding:6px 10px;border:none;border-radius:6px;background:#43a047;color:#fff;
                  font-size:12px;font-weight:600;cursor:pointer;
                "
              >Search</button>
            </div>
          </div>
        `;
      }).join('')
    : `
      <div style="font-size:13px;color:#6b7280;line-height:1.5;">
        No new or modified taxa in the current summary window for ${currentGroupName}.
      </div>
    `;

  panel.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div style="font-weight:700;font-size:14px;color:#1f2937;">Recent Change</div>
      <select id="summary-range-select" style="font-size:12px; border-radius:4px; border:1px solid #d1d5db; padding:2px 4px; background:#fff; cursor:pointer;">
        ${RANGE_OPTIONS.map(option => `
          <option value="${option.days}" ${currentRangeDays === option.days ? 'selected' : ''}>${option.label}</option>
        `).join('')}
      </select>
    </div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px;">
      Refreshed ${formatDateLabel(dataToRender.generated_at)} · ${getSummaryHeaderRangeLabel(currentRangeDays)} · Scope: ${currentGroupName}${coverageNote}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <span style="padding:4px 8px;border-radius:999px;background:#f3f4f6;font-size:12px;color:#374151;">
        ${filteredEntries.length} total
      </span>
      <span style="padding:4px 8px;border-radius:999px;background:#dcfce7;font-size:12px;color:#166534;">
        ${newCount} new
      </span>
      <span style="padding:4px 8px;border-radius:999px;background:#fef3c7;font-size:12px;color:#92400e;">
        ${modifiedCount} modified
      </span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:#9ca3af;margin-top:8px;">
      <div>
        ${filteredEntries.length === 0
          ? `No items in ${getRangeLabel(currentRangeDays)}`
          : `Page ${currentSummaryPage} of ${totalPages} · ${filteredEntries.length} items in ${getRangeLabel(currentRangeDays)}`}
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button
          id="summary-prev-page"
          ${currentSummaryPage <= 1 ? 'disabled' : ''}
          style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;background:${currentSummaryPage <= 1 ? '#f3f4f6' : '#fff'};color:${currentSummaryPage <= 1 ? '#9ca3af' : '#374151'};font-size:11px;cursor:${currentSummaryPage <= 1 ? 'default' : 'pointer'};"
        >Previous</button>
        <button
          id="summary-next-page"
          ${currentSummaryPage >= totalPages ? 'disabled' : ''}
          style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;background:${currentSummaryPage >= totalPages ? '#f3f4f6' : '#fff'};color:${currentSummaryPage >= totalPages ? '#9ca3af' : '#374151'};font-size:11px;cursor:${currentSummaryPage >= totalPages ? 'default' : 'pointer'};"
        >Next</button>
      </div>
    </div>
    <div style="margin-top:4px;max-height:360px;overflow-y:auto;">${rowsHtml}</div>
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
