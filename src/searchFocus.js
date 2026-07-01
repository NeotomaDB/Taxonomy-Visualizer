// Simple info panel to display the focused node and its ancestors
// Also displays taxon name label on the dendrogram
// Usage:
//   const info = setupFocusInfo(node, getCurrentRotate);
//   info.show(d); // to display d and its ancestors + label on dendrogram
//   info.clear(); // to hide
import { fetchAndRenderExternalLinks } from './externaltaxa.js';
import { fetchAndRenderTaxonMetadata } from './taxonMetadata.js';
import { fetchAndRenderTaxonSummary } from './taxonSummary.js';
import { isMajorGroupDisplayName } from './taxaViewConfig.js';
import { updateURLState } from './urlhash.js';

export function setupFocusInfo(nodeSelection, getCurrentRotate = () => 0, highlightOnlyTargetNode = false) {
  const panel = document.getElementById('info');
  let currentNode = null; // Store current node for button handler
  const currentClickIdRef = { value: null }; // Track current click for async fetch

  function show(d) {
    if (!panel || !d) return;

    currentNode = d; // Store current node
    const nodeId = d.data.taxonid || d.data.id;
    currentClickIdRef.value = nodeId; // Record current ID
    
    // Update URL hash state
    updateURLState({ focus: nodeId });

    // Update info panel
    const names = d.ancestors().reverse().map(n => n.data.name);

    // Build the dynamic path HTML
    const pathHtml = names.map((n, idx) => {
      if (idx === names.length - 1) {
        // The last child element gets the external links placeholder to its right
        return `<div style="margin-left:12px; display:flex; align-items:center;">
                  <span style="font-weight:600;">${n}</span>
                  <div id="ext-links-container" style="display:flex; gap:4px; margin-left:8px; height:20px; align-items:center;"></div>
                </div>`;
      }
      return `<div style="margin-left:12px;">${n}</div>`;
    }).join('');

    // Check if node has children (can have a subtree)
    // A node can have a subtree if:
    // 1. It has children in the current tree, OR
    // 2. We can check if there's data available to build a subtree
    const hasSubtree = (d.children && d.children.length > 0) ||
      (d.descendants && d.descendants().length > 1); // Has descendants beyond itself

    // Add "Go to Tree" button only if node has a subtree and navigateToNode is available
    const goToTreeButton = (hasSubtree && window.navigateToNode) ? `
      <button id="goToTreeFromClick" style="
        margin-top: 12px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #43a047, #43a047);
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        font-family: 'DM Sans', sans-serif;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
      " onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter='brightness(1)'">
        Go to Tree
      </button>
    ` : '';

    // Add "Go to Group View" button if node is an anchor or a synthetic taxa group entry (like non-bio categories)
    const isAnchor = d.data && d.data.isAnchor;
    const isSyntheticEntry = d.data && d.data.isSyntheticGroup;
    const taxagroupid = d.data && d.data.taxagroupid;
    const goToGroupButton = ((isAnchor || isSyntheticEntry) && taxagroupid && window.loadTreeForGroup) ? `
      <button id="goToGroupBtn" style="
        margin-top: 12px;
        margin-left: 8px;
        padding: 8px 16px;
        background: #2e7d32;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        font-family: 'DM Sans', sans-serif;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
      " onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter='brightness(1)'">
        <span>→</span>
        Go to Group View
      </button>
    ` : '';

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">Search Results (${names.length} matches)</div>
      <div style="margin-bottom:8px;"><strong>Path:</strong> ${pathHtml}</div>
      <div id="taxon-metadata-container"></div>
      <div id="taxon-summary-container"></div>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${goToTreeButton}
        ${goToGroupButton}
      </div>
    `;
    panel.style.display = 'block';

    const metadataContainer = document.getElementById('taxon-metadata-container');
    if (metadataContainer && currentClickIdRef.value) {
      fetchAndRenderTaxonMetadata(currentClickIdRef.value, metadataContainer, currentClickIdRef);
    }

    const summaryContainer = document.getElementById('taxon-summary-container');
    if (summaryContainer && currentClickIdRef.value && taxagroupid) {
      fetchAndRenderTaxonSummary(currentClickIdRef.value, taxagroupid, summaryContainer, currentClickIdRef);
    }

    // Fetch and render external links dynamically
    const extLinksContainer = document.getElementById('ext-links-container');
    if (extLinksContainer && currentClickIdRef.value) {
      fetchAndRenderExternalLinks(currentClickIdRef.value, extLinksContainer, currentClickIdRef);
    }

    // Add event listener for "Go to Tree" button
    const goToTreeBtn = document.getElementById('goToTreeFromClick');
    if (goToTreeBtn && window.navigateToNode) {
      const newBtn = goToTreeBtn.cloneNode(true);
      goToTreeBtn.parentNode.replaceChild(newBtn, goToTreeBtn);
      newBtn.addEventListener('click', () => {
        const nodeData = d.data;
        const tid = nodeData.taxagroupid || 'MAM';
        window.navigateToNode(nodeData.id, nodeData.name, tid);
      });
    }

    // Add event listener for "Go to Group View" button
    const goToGroupBtn = document.getElementById('goToGroupBtn');
    if (goToGroupBtn && window.loadTreeForGroup) {
      goToGroupBtn.addEventListener('click', () => {
        window.loadTreeForGroup(taxagroupid);
      });
    }

    // Add taxon name labels to all nodes in the path
    if (nodeSelection) {
      // Remove any existing focus styling
      nodeSelection.select('text').classed('focused-text', false);

      // Get all ancestors (the complete path from root to selected node)
      const pathNodes = d.ancestors();
      pathNodes.forEach(ancestorNode => {
        // Obey filtering rule: if we only want the target node name, skip intermediate nodes
        if (highlightOnlyTargetNode && ancestorNode !== d) {
          return;
        }
        const nodeGroup = nodeSelection.filter(n => n === ancestorNode);

        // Check if this is a collapsed group node
        const nodeName = (ancestorNode.data && ancestorNode.data.name) ? String(ancestorNode.data.name).trim().toLowerCase() : '';
        const isCollapsedGroup = isMajorGroupDisplayName(nodeName);

        nodeGroup.select('text:not(.toggle):not(.label-halo)')
          .classed('focused-text', true)
          .style('fill', isCollapsedGroup ? '#7cafae' : '#0d47a1');
      });
    }
  }

  function clear() {
    // Hide panel
    if (panel) panel.style.display = 'none';

    // Remove focus styling from dendrogram
    if (nodeSelection) {
      nodeSelection.select('text:not(.label-halo)').classed('focused-text', false).style('fill', null);
    }
  }

  // start hidden
  if (panel) panel.style.display = 'none';
  return { show, clear };
}
