function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function buildSynonymRelationships(synonymRows, getSynonymInfo) {
  const relationships = [];
  const seenInvalidIds = new Set();

  (synonymRows || []).forEach((row) => {
    const invalidId = row?.taxonid;
    if (invalidId == null || seenInvalidIds.has(invalidId)) return;

    const info = getSynonymInfo?.(invalidId);
    if (!info || info.validId == null || !info.validName) return;

    const record = (info.synonyms || []).find(
      (synonym) => String(synonym.invalid_id) === String(invalidId),
    );
    if (!record) return;

    seenInvalidIds.add(invalidId);
    relationships.push({
      invalidId,
      invalidName: record.invalid_name || row.taxonname || String(invalidId),
      validId: info.validId,
      validName: info.validName,
      synonymtype: record.synonymtype || '',
      recdatemodified: record.recdatemodified || '',
    });
  });

  return relationships.sort((a, b) => (
    a.invalidName.localeCompare(b.invalidName)
      || String(a.invalidId).localeCompare(String(b.invalidId))
  ));
}

function renderRelationshipRows(relationships) {
  if (relationships.length === 0) {
    return `
      <tr>
        <td class="synonym-relationships-empty" colspan="4">
          No synonym relationships match this filter.
        </td>
      </tr>
    `;
  }

  return relationships.map((relationship) => `
    <tr>
      <td class="synonym-relationship-name synonym-relationship-name--invalid">
        <span>${escapeHtml(relationship.invalidName)}</span>
        <small>ID ${escapeHtml(relationship.invalidId)}</small>
      </td>
      <td class="synonym-relationship-name synonym-relationship-name--valid">
        <span>${escapeHtml(relationship.validName)}</span>
        <small>ID ${escapeHtml(relationship.validId)}</small>
      </td>
      <td class="synonym-relationship-type">${escapeHtml(relationship.synonymtype || 'Unspecified synonym')}</td>
      <td class="synonym-relationship-date">${escapeHtml(formatDate(relationship.recdatemodified))}</td>
    </tr>
  `).join('');
}

function showSynonymRelationships(groupName, relationships) {
  const panel = document.getElementById('synonym-detail-panel');
  if (!panel) return;

  const isOpen = panel.style.display === 'block';
  if (isOpen) {
    panel.style.display = 'none';
    return;
  }

  panel.innerHTML = `
    <div class="synonym-relationships-panel-header">
      <div>
        <h3>${escapeHtml(groupName)} synonym relationships</h3>
        <p>Invalid names linked to the accepted taxon record used on the canvas.</p>
      </div>
      <button id="closeSynonymRelationships" class="synonym-relationships-close" type="button" aria-label="Close synonym relationships">
        ×
      </button>
    </div>
    <div class="synonym-relationships-table-wrap">
      <table class="synonym-relationships-table">
        <thead>
          <tr>
            <th scope="col">Invalid synonym</th>
            <th scope="col">Accepted name in Neotoma</th>
            <th scope="col">Relationship</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>${renderRelationshipRows(relationships)}</tbody>
      </table>
    </div>
  `;
  panel.style.display = 'block';

  document.getElementById('closeSynonymRelationships')?.addEventListener('click', () => {
    panel.style.display = 'none';
  });
}

export function updateSynonymBar(taxagroupid, groupName, relationships) {
  const bar = document.getElementById('synonym-bar');
  const panel = document.getElementById('synonym-detail-panel');
  if (!bar) return;

  if (panel) {
    panel.style.display = 'none';
    panel.innerHTML = '';
  }

  if (!relationships || relationships.length === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }

  bar.innerHTML = `
    <button id="viewSynonymRelationships" class="synonym-relationships-summary" type="button" aria-label="View synonym relationships for ${escapeHtml(groupName)}">
      <span class="synonym-relationships-summary-copy">
        <span class="summary-toggle-icon synonym-relationships-summary-spacer" aria-hidden="true">▾</span>
        <strong>Synonym Relationships</strong>
      </span>
      <span class="synonym-relationships-summary-count" aria-label="${relationships.length.toLocaleString()} relationships">
        ${relationships.length.toLocaleString()}
      </span>
      <span class="synonym-relationships-summary-action">View <span aria-hidden="true">›</span></span>
    </button>
  `;
  bar.style.display = 'block';
  bar.dataset.taxagroupid = taxagroupid;

  document.getElementById('viewSynonymRelationships')?.addEventListener('click', () => {
    showSynonymRelationships(groupName, relationships);
  });
}
