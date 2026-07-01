import { fetchTaxonSummaryRecord, isOccurrenceSummaryEnabled } from './taxonSummary.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function renderHoverTaxonInfo(name, record = null) {
    const safeName = escapeHtml(name);
    if (!record) return safeName;
    return `
        <div style="font-weight:700;margin-bottom:4px;">${safeName}</div>
        <div style="font-weight:500;color:#475569;">
            ${record.occurrenceCount} occurrences · ${record.datasetCount} datasets · ${record.siteCount} sites
        </div>
    `;
}

export function setupHover(nodeSelection, { taxagroupid = null } = {}) {
    let tooltip = document.getElementById('hover-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'hover-tooltip';
        tooltip.style.position = 'absolute';
        tooltip.style.background = '#fff';
        tooltip.style.border = '1px solid #ddd';
        tooltip.style.padding = '5px 10px';
        tooltip.style.borderRadius = '4px';
        tooltip.style.pointerEvents = 'none'; // Important so mouse doesn't get stuck on tooltip
        tooltip.style.zIndex = '1001';
        tooltip.style.display = 'none';
        tooltip.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
        tooltip.style.fontSize = '12px';
        tooltip.style.fontWeight = '500';
        tooltip.style.color = '#333';
        tooltip.style.maxWidth = '260px';
        document.body.appendChild(tooltip);
    }

    let hoverRequestId = 0;

    nodeSelection
        .on('mouseover.hover', (event, d) => {
            hoverRequestId += 1;
            const requestId = hoverRequestId;
            const nodeTaxagroupid = d?.data?.taxagroupid || taxagroupid;
            const taxonId = d?.data?.taxonid || d?.data?.id;

            tooltip.style.display = 'block';
            tooltip.innerHTML = renderHoverTaxonInfo(d.data.name);
            tooltip.style.left = (event.pageX + 10) + 'px';
            tooltip.style.top = (event.pageY + 10) + 'px';

            if (taxonId && isOccurrenceSummaryEnabled(nodeTaxagroupid)) {
                fetchTaxonSummaryRecord(taxonId, nodeTaxagroupid).then(record => {
                    if (requestId !== hoverRequestId || tooltip.style.display === 'none') return;
                    tooltip.innerHTML = renderHoverTaxonInfo(d.data.name, record);
                });
            }
        })
        .on('mousemove.hover', (event) => {
            tooltip.style.left = (event.pageX + 10) + 'px';
            tooltip.style.top = (event.pageY + 10) + 'px';
        })
        .on('mouseout.hover', () => {
            hoverRequestId += 1;
            tooltip.style.display = 'none';
        });
}
