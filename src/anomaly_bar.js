import { TAXONOMIC_ISSUE_TYPES } from './groupAnomalyRows.js';

const ISSUE_TYPE_META = Object.freeze({
  [TAXONOMIC_ISSUE_TYPES.UNPLACED]: {
    label: 'Unplaced',
    tone: 'neutral',
  },
  [TAXONOMIC_ISSUE_TYPES.SHALLOW_PLACEMENT]: {
    label: 'Shallow placement',
    tone: 'review',
  },
  [TAXONOMIC_ISSUE_TYPES.MISSING_SUBORDINATE_DATA]: {
    label: 'Missing subordinate data',
    tone: 'review',
  },
  [TAXONOMIC_ISSUE_TYPES.PLACEMENT_CONFLICT]: {
    label: 'Placement conflict',
    tone: 'conflict',
  },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function issueTypeOptions() {
  return Object.entries(ISSUE_TYPE_META)
    .map(([value, meta]) => `<option value="${value}">${meta.label}</option>`)
    .join('');
}

function renderIssueRows(issues) {
  if (issues.length === 0) {
    return `
      <tr>
        <td class="taxonomic-issues-empty" colspan="4">
          No issues match this filter.
        </td>
      </tr>
    `;
  }

  return issues.map((issue) => {
    const meta = ISSUE_TYPE_META[issue.issueType] || {
      label: issue.issueType,
      tone: 'neutral',
    };
    const path = (issue.names_root_to_leaf || []).join(' › ');

    return `
      <tr>
        <td class="taxonomic-issue-taxon">
          <span>${escapeHtml(issue.taxonname)}</span>
          <small>ID ${escapeHtml(issue.taxonid)}</small>
        </td>
        <td class="taxonomic-issue-path">${escapeHtml(path || issue.taxonname)}</td>
        <td>
          <span class="taxonomic-issue-badge" data-tone="${meta.tone}">
            ${escapeHtml(meta.label)}
          </span>
        </td>
        <td class="taxonomic-issue-next-step">${escapeHtml(issue.suggestedNextStep)}</td>
      </tr>
    `;
  }).join('');
}

function showPotentialIssues(groupName, issues) {
  const panel = document.getElementById('anomaly-detail-panel');
  if (!panel) return;

  const isOpen = panel.style.display === 'block'
    && panel.getAttribute('data-content-type') === 'potential-taxonomic-issues';

  if (isOpen) {
    panel.style.display = 'none';
    panel.removeAttribute('data-content-type');
    return;
  }

  panel.innerHTML = `
    <div class="taxonomic-issues-panel-header">
      <div>
        <h3>Potential Taxonomic Issues</h3>
        <p>${escapeHtml(groupName)} · <span id="taxonomicIssueVisibleCount">${issues.length.toLocaleString()}</span> shown</p>
      </div>
      <button id="closeTaxonomicIssues" class="taxonomic-issues-close" type="button" aria-label="Close potential taxonomic issues">
        ×
      </button>
    </div>

    <div class="taxonomic-issues-toolbar">
      <label for="taxonomicIssueTypeFilter">Filter</label>
      <select id="taxonomicIssueTypeFilter">
        <option value="all">All issue types</option>
        ${issueTypeOptions()}
      </select>
    </div>

    <div class="taxonomic-issues-table-wrap">
      <table class="taxonomic-issues-table">
        <thead>
          <tr>
            <th scope="col">Taxon</th>
            <th scope="col">Current / recorded path</th>
            <th scope="col">Issue type</th>
            <th scope="col">Suggested next step</th>
          </tr>
        </thead>
        <tbody id="taxonomicIssuesTableBody">
          ${renderIssueRows(issues)}
        </tbody>
      </table>
    </div>
  `;

  panel.style.display = 'block';
  panel.setAttribute('data-content-type', 'potential-taxonomic-issues');

  const filter = document.getElementById('taxonomicIssueTypeFilter');
  const tableBody = document.getElementById('taxonomicIssuesTableBody');
  const visibleCount = document.getElementById('taxonomicIssueVisibleCount');

  filter?.addEventListener('change', () => {
    const filteredIssues = filter.value === 'all'
      ? issues
      : issues.filter((issue) => issue.issueType === filter.value);

    if (tableBody) tableBody.innerHTML = renderIssueRows(filteredIssues);
    if (visibleCount) visibleCount.textContent = filteredIssues.length.toLocaleString();
  });

  document.getElementById('closeTaxonomicIssues')?.addEventListener('click', () => {
    panel.style.display = 'none';
    panel.removeAttribute('data-content-type');
  });
}

export function updateAnomalyBar(taxagroupid, groupName, issues) {
  const bar = document.getElementById('anomaly-bar');
  const panel = document.getElementById('anomaly-detail-panel');
  if (!bar) return;

  if (panel) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    panel.removeAttribute('data-content-type');
  }

  if (issues.length === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = `
    <button id="viewPotentialTaxonomicIssues" class="taxonomic-issues-summary" type="button">
      <span class="taxonomic-issues-summary-copy">
        <strong>Potential Taxonomic Issues</strong>
        <span>${escapeHtml(groupName)}</span>
      </span>
      <span class="taxonomic-issues-summary-count" aria-label="${issues.length.toLocaleString()} issues">
        ${issues.length.toLocaleString()}
      </span>
      <span class="taxonomic-issues-summary-action">Review <span aria-hidden="true">›</span></span>
    </button>
  `;
  bar.style.display = 'block';
  bar.dataset.taxagroupid = taxagroupid;

  document.getElementById('viewPotentialTaxonomicIssues')?.addEventListener('click', () => {
    showPotentialIssues(groupName, issues);
  });
}
