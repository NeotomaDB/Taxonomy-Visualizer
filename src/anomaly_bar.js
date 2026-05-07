/**
 * Anomaly Bar UI Component
 * Handles the display of the anomaly status bar and detail panels.
 */

export function updateAnomalyBar(taxagroupid, groupName, anomalies, orphanNodes, rootName) {
    const bar = document.getElementById('anomaly-bar');
    const detailPanel = document.getElementById('anomaly-detail-panel');
    if (!bar) return;

    // Filter out the root record itself (e.g. "Acritarcha") if present
    const filteredOrphans = rootName 
        ? orphanNodes.filter(node => node.taxonname !== rootName)
        : orphanNodes;

    // Always collapse detail panel when switching groups
    if (detailPanel) {
        detailPanel.style.display = 'none';
        detailPanel.innerHTML = ''; // Clear previous content
    }

    if (filteredOrphans.length === 0 && anomalies.length === 0) {
        bar.style.display = 'none';
        return;
    }

    const parts = [];

    if (filteredOrphans.length > 0) {
        parts.push(`
            <span style="color:#6b7280; display:flex; align-items:center;">
                Unplaced Taxa, Orphan Taxa or Taxa Lacking Subordinate Data under the ${groupName} Group: ${filteredOrphans.length.toLocaleString()} 
                <button id="viewOrphansBtn" style="
                    background:none; border:none; color:#0d47a1; cursor:pointer; 
                    font-size:14px; margin-left:4px; padding:0; display:inline-flex; align-items:center;
                " title="View Unplaced Taxa">
                    ▼
                </button>
            </span>
        `);
    }

    if (anomalies.length > 0) {
        // Build tooltip: list example path beginning so researchers can spot the issue
        const exPath = anomalies[0].actualPath.split(' → ').slice(0, 3).join(', ');
        const tooltipText =
            `${anomalies.length} record(s) in ${taxagroupid} have paths ` +
            `inconsistent with this taxagroup (e.g. ${exPath}). ` +
            `These are excluded from the tree.`;

        parts.push(`
            <span style="color:#6b7280; display:flex; align-items:center;">
                <span style="color:#dc2626; font-weight:600;">${anomalies.length}</span>
                &nbsp;data anomalies
                <abbr title="${tooltipText}" style="
                    cursor:help; text-decoration:none;
                    display:inline-flex; align-items:center; justify-content:center;
                    width:15px; height:15px; border-radius:50%;
                    background:#fee2e2; color:#dc2626;
                    font-size:9px; font-weight:700;
                    margin-left:3px; vertical-align:middle;
                ">?</abbr>
                <button id="viewAnomalyDetails" style="
                    background:none; border:none; margin-left:7px; color:#0d47a1; font-size:12px; text-decoration:underline; cursor:pointer; padding:0;
                ">View details →</button>
            </span>
        `);
    }

    const sep = `<span style="color:#d1d5db; margin:0 6px;">|</span>`;
    bar.innerHTML =
        `<div style="font-size:12px; display:flex; align-items:center; flex-wrap:wrap;">` +
        parts.join(sep) +
        `</div>`;
    bar.style.display = 'block';

    // Wire up "View Orhpans" toggle
    const viewOrphansBtn = document.getElementById('viewOrphansBtn');
    if (viewOrphansBtn) {
        viewOrphansBtn.addEventListener('click', e => {
            e.preventDefault();
            // Toggle arrow direction
            if (viewOrphansBtn.textContent.trim() === '▼') {
                viewOrphansBtn.textContent = '▲';
            } else {
                viewOrphansBtn.textContent = '▼';
            }
            showOrphanDetail(groupName, filteredOrphans, rootName);
        });
    }

    // Wire up "View details" toggle
    const viewLink = document.getElementById('viewAnomalyDetails');
    if (viewLink) {
        viewLink.addEventListener('click', e => {
            e.preventDefault();
            showAnomalyDetail(taxagroupid, anomalies);
        });
    }
}

function showOrphanDetail(groupName, orphanNodes, rootName) {
    const panel = document.getElementById('anomaly-detail-panel');
    if (!panel) return;

    // Determine current state
    const isShowingOrphans = panel.getAttribute('data-content-type') === 'orphans';

    // Toggle: close if already open and showing the same content
    if (panel.style.display === 'block' && isShowingOrphans) {
        panel.style.display = 'none';
        panel.removeAttribute('data-content-type');
        return;
    }

    const rows = orphanNodes.map(node => {
        const pathArray = node.names_root_to_leaf || [];

        return `<tr>
            <td style="padding:6px; border-bottom:1px solid #e5e7eb; font-weight:600;">${node.taxonid}</td>
            <td style="padding:6px; border-bottom:1px solid #e5e7eb;">${node.taxonname}</td>
            <td style="padding:6px; border-bottom:1px solid #e5e7eb; color:#4b5563; font-family:monospace; font-size:11px;">
                ${pathArray.join(' <span style="color:#9ca3af;">→</span> ')}
            </td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
        <div style="font-weight:600; font-size:14px; margin-bottom:10px;">
            Unplaced Taxa & Orphan Nodes in ${groupName} (${orphanNodes.length})
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
            <thead>
                <tr style="background:#f3f4f6;">
                    <th style="padding:6px; font-weight:600; width:15%;">ID</th>
                    <th style="padding:6px; font-weight:600; width:25%;">Name</th>
                    <th style="padding:6px; font-weight:600;">Path Recorded</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
        <button id="closeOrphanDetail" style="
            margin-top:12px; padding:4px 12px; background:#f3f4f6;
            border:1px solid #d1d5db; border-radius:4px;
            font-size:12px; cursor:pointer;
        ">Close</button>
    `;
    panel.style.display = 'block';
    panel.setAttribute('data-content-type', 'orphans');

    const closeBtn = document.getElementById('closeOrphanDetail');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
            panel.removeAttribute('data-content-type');
            const toggle = document.getElementById('viewOrphansBtn');
            if (toggle) toggle.textContent = '▼';
        });
    }
}

function showAnomalyDetail(taxagroupid, anomalies) {
    const panel = document.getElementById('anomaly-detail-panel');
    if (!panel) return;

    const isShowingAnomalies = panel.getAttribute('data-content-type') === 'anomalies';

    // Toggle: close if already open and showing same content
    if (panel.style.display === 'block' && isShowingAnomalies) {
        panel.style.display = 'none';
        panel.removeAttribute('data-content-type');
        return;
    }

    const rows = anomalies.map(a => {
        // Find where the branch splits visually
        let expectedStr = a.expectedValidPath || '';
        let expectedArr = expectedStr ? expectedStr.split(' → ') : [];
        let actualArr = (a.actualPath || '').split(' → ');

        let pathHtml = '';
        const len = Math.max(expectedArr.length, actualArr.length);
        for (let i = 0; i < len; i++) {
            if (actualArr[i] === expectedArr[i]) {
                pathHtml += `<span>${actualArr[i]}</span>`;
            } else {
                let act = actualArr[i] || '';
                pathHtml += `<span style="color:#dc2626; font-weight:600;">${act}</span>`;
            }
            if (i < len - 1) pathHtml += ' → ';
        }

        return `<tr>
            <td style="padding:6px; border-bottom:1px solid #e5e7eb; font-weight:600;">${a.taxonid}</td>
            <td style="padding:6px; border-bottom:1px solid #e5e7eb;">${a.taxonname}</td>
            <td style="padding:6px; border-bottom:1px solid #e5e7eb;">${pathHtml}</td>
        </tr>`;
    }).join('');

    panel.innerHTML = `
        <div style="font-weight:600; font-size:14px; margin-bottom:10px;">
            Inconsistent Paths Detected for ${taxagroupid}
            <span style="font-weight:400; font-size:12px; color:#6b7280; margin-left:8px;">
                Expected hierarchy anchor: <strong>${anomalies[0]?.expectedValidPath || 'unknown'}</strong>
            </span>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;">
            <thead>
                <tr style="background:#f3f4f6;">
                    <th style="padding:6px; font-weight:600; width:60px;">ID</th>
                    <th style="padding:6px; font-weight:600; width:120px;">Name</th>
                    <th style="padding:6px; font-weight:600;">Actual Path Recorded</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
        <button id="closeAnomalyDetail" style="
            margin-top:12px; padding:4px 12px; background:#f3f4f6;
            border:1px solid #d1d5db; border-radius:4px;
            font-size:12px; cursor:pointer;
        ">Close</button>
    `;
    panel.style.display = 'block';
    panel.setAttribute('data-content-type', 'anomalies');

    const closeBtn = document.getElementById('closeAnomalyDetail');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
            panel.removeAttribute('data-content-type');
        });
    }
}
