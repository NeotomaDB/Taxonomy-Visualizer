// Search functionality for the radial tree visualization
// Supports synonym search - searches both valid and invalid taxonomic names
// Usage:
//   setupSearch({
//     root,                    // d3.hierarchy root node
//     link,                    // d3 selection of links
//     node,                    // d3 selection of nodes
//     info,                    // info panel object with show() and clear() methods
//     setCurrentRotate,         // function to set current rotation
//     updateRotate,             // function to update rotation transform
//     updateLabelOrientation    // function to update label orientation
//   });

import {
  getAllSynonymIds,
  getAllSynonymNames,
  isInvalidId,
  getSynonymInfo,
  isSynonymsReady
} from './synonyms.js';
import { setHighlightedPath, clearHighlightedPath, setMatchIds } from './viewSwitch.js';

export function setupSearch({
  root,
  link,
  node,
  info,
  setCurrentRotate,
  updateRotate,
  updateLabelOrientation,
  expandToNode
}) {
  function getAllNodes(n) {
    const arr = [n];
    if (n.children) n.children.forEach(c => arr.push(...getAllNodes(c)));
    if (n._children) n._children.forEach(c => arr.push(...getAllNodes(c)));
    return arr;
  }

  const idToNode = new Map();
  getAllNodes(root).forEach(n => idToNode.set(n.data.id, n));
  let currentMatches = [];
  let currentMatchIndex = -1;
  let isShowingDetails = false; // Track if we're showing details of a single result
  let primaryMatchIds = new Set(); // IDs that directly matched the search query
  let synonymMatchIds = new Set(); // IDs that matched through synonym relationships
  // Maps canonical node ID → array of resolved synonym info objects
  // e.g. { searchedTerm, invalidId, invalidName, synonymtype, recdatemodified }
  let synonymResolutions = new Map();

  function focusNode(d) {
    // Ensure path to node is expanded first
    if (expandToNode) expandToNode(d);

    setCurrentRotate(90 - (d.x * 180 / Math.PI));
    updateRotate();
    updateLabelOrientation();
    const A = new Set(d.ancestors());
    link.classed('highlight', l => A.has(l.source) && A.has(l.target));
    node.select('text').classed('highlight', n => A.has(n));
    setHighlightedPath(d);
    if (info) info.show(d);
  }

  function highlightAllMatches(matches) {
    // Expand paths to all matching nodes so they are visible in the tree
    if (expandToNode && matches.length > 0) {
      matches.forEach(m => expandToNode(m));
    }

    // Clear previous highlights
    link.classed('highlight', false);
    link.classed('highlight-synonym', false);
    node.select('text').classed('highlight', false);
    node.select('text').classed('highlight-synonym', false);

    if (matches.length === 0) return;

    // Collect all ancestors for primary and synonym matches separately
    const primaryAncestors = new Set();
    const synonymAncestors = new Set();

    // First pass: collect primary ancestors
    matches.forEach(m => {
      if (primaryMatchIds.has(m.data.id)) {
        m.ancestors().forEach(a => primaryAncestors.add(a));
      }
    });

    // Second pass: collect synonym ancestors (including shared ones)
    matches.forEach(m => {
      if (synonymMatchIds.has(m.data.id)) {
        m.ancestors().forEach(a => synonymAncestors.add(a));
      }
    });

    // Highlight links
    // A link gets primary highlight if both nodes are in primary path
    // A link gets synonym highlight if both nodes are in synonym path but NOT both in primary path
    link.classed('highlight', l =>
      primaryAncestors.has(l.source) && primaryAncestors.has(l.target)
    );
    link.classed('highlight-synonym', l => {
      const inSynonym = synonymAncestors.has(l.source) && synonymAncestors.has(l.target);
      const inPrimary = primaryAncestors.has(l.source) && primaryAncestors.has(l.target);
      return inSynonym && !inPrimary;
    });

    // Highlight text nodes
    node.select('text').classed('highlight', d => primaryMatchIds.has(d.data.id));
    node.select('text').classed('highlight-synonym', d => synonymMatchIds.has(d.data.id));
  }

  function showSearchResultsList() {
    // Show the list of all search results
    isShowingDetails = false;
    const panel = document.getElementById('info');
    if (!panel || currentMatches.length === 0) return;

    highlightAllMatches(currentMatches);

    const matchList = currentMatches.map((m, idx) => {
      const path = m.ancestors().reverse().map(n => n.data.name).join(' / ');

      // Show synonym resolution badge when this node was found via a synonym search
      let synonymBadge = '';
      const resolutions = synonymResolutions.get(m.data.id);
      if (resolutions && resolutions.length > 0) {
        const resolvedNames = resolutions.map(r => r.invalidName).join(', ');
        synonymBadge = `<span style="
          margin-left: 6px;
          padding: 2px 6px;
          background: #fef3c7;
          color: #92400e;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        ">via synonym: ${resolvedNames}</span>`;
      }

      // Add "Go to Tree" button if node has children
      const hasChildren = m.children && m.children.length > 0;
      const goToTreeBtn = hasChildren && window.navigateToNode ? `
        <button class="go-to-tree-btn" data-index="${idx}" style="
          margin-top: 4px;
          padding: 4px 8px;
          background: #43a047;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
        " onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter='brightness(1)'">
          Go to Tree
        </button>
      ` : '';

      return `<div style="cursor:pointer;padding:6px 0;border-bottom:1px solid #e5e7eb;" data-index="${idx}" class="search-result-item">
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div>${path}</div>
          ${synonymBadge ? `<div style="font-size:12px;">${synonymBadge}</div>` : ''}
          ${goToTreeBtn}
        </div>
      </div>`;
    }).join('');

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">Search Results (${currentMatches.length} matches)</div>
      <div style="max-height:300px;overflow-y:auto;">${matchList}</div>
    `;
    panel.style.display = 'block';

    // Add click handlers for each result
    panel.querySelectorAll('.search-result-item').forEach((item, idx) => {
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking the "Go to Tree" button
        if (e.target.classList.contains('go-to-tree-btn')) {
          return;
        }
        currentMatchIndex = idx;
        isShowingDetails = true;
        const selectedNode = currentMatches[idx];
        focusNode(selectedNode);
        showNodeDetails(selectedNode);
      });
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f3f4f6';
      });
      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });
    });

    // Add handlers for "Go to Tree" buttons
    panel.querySelectorAll('.go-to-tree-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index'));
        const selectedNode = currentMatches[idx];
        if (selectedNode && window.navigateToNode) {
          const nodeData = selectedNode.data;
          const taxagroupid = nodeData.taxagroupid || 'MAM';
          window.navigateToNode(nodeData.id, nodeData.name, taxagroupid);
        }
      });
    });
  }

  function showNodeDetails(selectedNode) {
    const panel = document.getElementById('info');
    if (!panel) return;

    const names = selectedNode.ancestors().reverse().map(n => n.data.name);
    const nodeId = selectedNode.data.id;

    const formatDate = (dateStr) => {
      if (!dateStr) return 'N/A';
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // ── Synonym resolution banner ─────────────────────────────────────────────
    // Shown when the user searched an invalid (synonym) name and we resolved it
    // to this canonical node.
    let resolutionBanner = '';
    const resolutions = synonymResolutions.get(nodeId);
    if (resolutions && resolutions.length > 0) {
      resolutionBanner = `
        <div style="
          margin-top:10px; padding:10px 12px;
          background:#fffbeb; border-left:3px solid #f59e0b; border-radius:4px;
        ">
          <div style="font-weight:700;font-size:13px;color:#92400e;margin-bottom:6px;">
            🔍 Matched via synonym
          </div>
          ${resolutions.map(r => `
            <div style="margin-bottom:6px;">
              <span style="
                display:inline-block; padding:2px 7px;
                background:#fef3c7; color:#92400e;
                border-radius:4px; font-size:12px; font-weight:600;
              ">${r.invalidName}</span>
              <span style="font-size:12px;color:#6b7280;margin-left:4px;">is an invalid name (synonym) for this taxon</span>
              ${r.synonymtype ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px;">Type: ${r.synonymtype}${r.recdatemodified ? ' · Modified: ' + formatDate(r.recdatemodified) : ''}</div>` : ''}
            </div>
          `).join('')}
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">
            The tree shows the valid (accepted) name:
            <strong style="color:#1f2937;">${selectedNode.data.name}</strong>
          </div>
        </div>
      `;
    }

    // ── Synonym list from metadata on the canonical node ──────────────────────
    let synonymSection = '';
    const meta = selectedNode.data.synonymMetadata;
    if (meta && meta.synonyms && meta.synonyms.length > 0) {
      synonymSection = `
        <div style="
          margin-top:12px; padding:10px;
          background:#f9fafb; border-left:3px solid #1976d2; border-radius:4px;
        ">
          <div style="font-weight:600;font-size:14px;color:#1f2937;margin-bottom:8px;">
            Known synonyms (invalid names)
          </div>
          <div style="font-size:13px;color:#6b7280;margin-bottom:6px;">
            These names appear in the literature but are not accepted in the current taxonomy.
          </div>
          ${meta.synonyms.map(syn => `
            <div style="padding:5px 0;border-top:1px solid #e5e7eb;margin-top:4px;">
              <div style="font-weight:600;color:#f59e0b;">
                • ${syn.invalid_name}
                <span style="font-size:11px;color:#dc2626;font-weight:400;margin-left:4px;">invalid name</span>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-left:12px;margin-top:2px;">
                ${syn.synonymtype ? 'Type: ' + syn.synonymtype : ''}
                ${syn.synonymtype && syn.recdatemodified ? ' · ' : ''}
                ${syn.recdatemodified ? 'Modified: ' + formatDate(syn.recdatemodified) : ''}
              </div>
            </div>
          `).join('')}
          <div style="font-size:11px;color:#9ca3af;margin-top:8px;font-style:italic;">
            Synonym data from the Neotoma database. Invalid names are not rendered as tree nodes.
          </div>
        </div>
      `;
    }

    // Only show back button if there are multiple matches to go back to
    const backButton = currentMatches.length > 1 ? `
      <button id="backToResults" style="
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
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s ease;
      " onmouseover="this.style.filter='brightness(1.1)'" onmouseout="this.style.filter='brightness(1)'">
        Back to Results
      </button>
    ` : '';

    // Check if node has children (can have a subtree)
    const hasSubtree = selectedNode && (
      (selectedNode.children && selectedNode.children.length > 0) ||
      (selectedNode.descendants && selectedNode.descendants().length > 1)
    );

    // Add "Go to Tree" button - only show if node has a subtree
    const goToTreeButton = (hasSubtree && window.navigateToNode) ? `
      <button id="goToTree" style="
        margin-top: 12px;
        ${currentMatches.length > 1 ? 'margin-left: 8px;' : ''}
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

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">Search Results (${currentMatches.length} matches)</div>
      <div style="margin-bottom:8px;"><strong>Path:</strong> ${names.map(n => `<div style="margin-left:12px;">${n}</div>`).join('')}</div>
      ${resolutionBanner}
      ${synonymSection}
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        ${backButton}
        ${goToTreeButton}
      </div>
    `;
    panel.style.display = 'block';

    // Add back button handler if it exists
    const backBtn = document.getElementById('backToResults');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (info) info.clear();
        showSearchResultsList();
      });
    }

    // Add go to tree button handler if it exists
    const goToTreeBtn = document.getElementById('goToTree');
    if (goToTreeBtn && window.navigateToNode) {
      goToTreeBtn.addEventListener('click', () => {
        const nodeData = selectedNode.data;
        const taxagroupid = nodeData.taxagroupid || 'MAM';
        window.navigateToNode(nodeData.id, nodeData.name, taxagroupid);
      });
    }
  }

  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  function runSearch() {
    if (!searchInput) return;
    const q = searchInput.value.trim();

    // Clear previous focus labels before starting new search
    if (info) info.clear();

    if (!q) {
      // Clear search results
      currentMatches = [];
      currentMatchIndex = -1;
      primaryMatchIds = new Set();
      synonymMatchIds = new Set();
      link.classed('highlight', false);
      link.classed('highlight-synonym', false);
      node.select('text').classed('highlight', false);
      node.select('text').classed('highlight-synonym', false);
      clearHighlightedPath();
      return;
    }

    let matches = [];
    const matchedIds = new Set();
    primaryMatchIds = new Set();
    synonymMatchIds = new Set();
    synonymResolutions = new Map(); // Reset per search

    // Helper: resolve an invalid ID to its canonical node (if in tree)
    const reverseMap = window.__invalidIdToCanonicalId || new Map();

    const numericId = Number(q);
    const isIdSearch = !Number.isNaN(numericId) && Number.isInteger(numericId) && q.trim() !== '';

    if (isIdSearch) {
      // ── ID search ──────────────────────────────────────────────────────────
      if (idToNode.has(numericId)) {
        // Found directly in tree → primary match
        matches.push(idToNode.get(numericId));
        matchedIds.add(numericId);
        primaryMatchIds.add(numericId);
      } else if (reverseMap.has(numericId)) {
        // Not in tree but resolves to a canonical node via synonym metadata
        const canonicalId = reverseMap.get(numericId);
        if (idToNode.has(canonicalId) && !matchedIds.has(canonicalId)) {
          const canonicalNode = idToNode.get(canonicalId);
          matches.push(canonicalNode);
          matchedIds.add(canonicalId);
          synonymMatchIds.add(canonicalId);
          // Record resolution so the panel can explain it
          const synMeta = canonicalNode.data.synonymMetadata;
          const synDetail = synMeta?.synonyms?.find(s => s.invalid_id === numericId);
          synonymResolutions.set(canonicalId, [{
            searchedTerm: q.trim(),
            invalidId: numericId,
            invalidName: synDetail?.invalid_name ?? String(numericId),
            synonymtype: synDetail?.synonymtype ?? '',
            recdatemodified: synDetail?.recdatemodified ?? ''
          }]);
        }
      }
    } else {
      // ── Name search ────────────────────────────────────────────────────────
      const lower = q.toLowerCase().replace(/^\?+/, '').trim(); // strip leading ? (uncertain name notation)

      // Pass 1: direct name match against nodes in the tree
      getAllNodes(root).forEach(n => {
        if ((n.data.name || '').toLowerCase().includes(lower)) {
          if (!matchedIds.has(n.data.id)) {
            matches.push(n);
            matchedIds.add(n.data.id);
            primaryMatchIds.add(n.data.id);
          }
        }
      });

      // Pass 2: match against synonym metadata attached to canonical nodes
      // Each canonical node carries node.data.synonymMetadata.synonyms[]
      getAllNodes(root).forEach(n => {
        const meta = n.data.synonymMetadata;
        if (!meta) return;

        const matchingSyns = meta.synonyms.filter(syn =>
          syn.invalid_name.toLowerCase().includes(lower)
        );

        if (matchingSyns.length > 0) {
          const canonicalId = n.data.id;
          if (!matchedIds.has(canonicalId)) {
            matches.push(n);
            matchedIds.add(canonicalId);
            synonymMatchIds.add(canonicalId);
          }
          // Record all matching synonym names for this canonical node
          const existing = synonymResolutions.get(canonicalId) || [];
          matchingSyns.forEach(syn => {
            if (!existing.some(r => r.invalidId === syn.invalid_id)) {
              existing.push({
                searchedTerm: q.trim(),
                invalidId: syn.invalid_id,
                invalidName: syn.invalid_name,
                synonymtype: syn.synonymtype ?? '',
                recdatemodified: syn.recdatemodified ?? ''
              });
            }
          });
          synonymResolutions.set(canonicalId, existing);
        }
      });

      // Pass 3: check the reverseMap by name key for any remaining hits
      // (covers synonyms not attached as metadata on nodes in current tree)
      if (reverseMap.size > 0) {
        reverseMap.forEach((canonicalId, key) => {
          if (typeof key !== 'string') return; // skip numeric keys (handled above)
          if (!key.includes(lower)) return;
          if (!idToNode.has(canonicalId)) return;
          if (matchedIds.has(canonicalId)) return;

          const canonicalNode = idToNode.get(canonicalId);
          matches.push(canonicalNode);
          matchedIds.add(canonicalId);
          synonymMatchIds.add(canonicalId);

          const meta = canonicalNode.data.synonymMetadata;
          const synDetail = meta?.synonyms?.find(s => s.invalid_name.toLowerCase() === key);
          const existing = synonymResolutions.get(canonicalId) || [];
          existing.push({
            searchedTerm: q.trim(),
            invalidId: synDetail?.invalid_id ?? null,
            invalidName: synDetail?.invalid_name ?? key,
            synonymtype: synDetail?.synonymtype ?? '',
            recdatemodified: synDetail?.recdatemodified ?? ''
          });
          synonymResolutions.set(canonicalId, existing);
        });
      }
    }

    currentMatches = matches;
    currentMatchIndex = -1;

    // Set match IDs for Focus View
    const allMatchIds = new Set([...primaryMatchIds, ...synonymMatchIds]);
    setMatchIds(allMatchIds);

    // Debug: log the classification of matches and check for synonyms not in tree
    console.log('Search results for:', q);
    console.log('Primary match IDs:', Array.from(primaryMatchIds));
    console.log('Synonym match IDs:', Array.from(synonymMatchIds));
    console.log('Total matches:', matches.length);
    matches.forEach(m => {
      const type = primaryMatchIds.has(m.data.id) ? 'PRIMARY' :
                   synonymMatchIds.has(m.data.id) ? 'SYNONYM' : 'UNKNOWN';
      console.log(`  - ${m.data.name} (ID: ${m.data.id}) [${type}]`);
    });

    // Check if there are synonyms that exist in the synonym database but not in the current tree
    if (isSynonymsReady() && (primaryMatchIds.size > 0 || synonymMatchIds.size > 0)) {
      const allCheckedIds = new Set([...primaryMatchIds, ...synonymMatchIds]);
      allCheckedIds.forEach(matchId => {
        const synonymInfo = getSynonymInfo(matchId);
        if (synonymInfo) {
          const allSynonymIds = getAllSynonymIds(matchId);
          const allSynonymNames = getAllSynonymNames(matchId);
          const missingInTree = [];

          // Check each synonym ID
          synonymInfo.synonyms.forEach(syn => {
            if (!idToNode.has(syn.invalid_id)) {
              missingInTree.push({
                id: syn.invalid_id,
                name: syn.invalid_name,
                type: syn.synonymtype
              });
            }
          });

          if (missingInTree.length > 0) {
            console.log(`⚠️ Synonyms of "${synonymInfo.validName}" (ID: ${synonymInfo.validId}) not in current tree:`, missingInTree);
          }
        }
      });
    }

    if (matches.length === 0) {
      if (info) {
        const panel = document.getElementById('info');
        if (panel) {
          panel.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">Search Results</div><div style="color:#6b7280;">No matches found for "${q}"</div>`;
          panel.style.display = 'block';
        }
      }
      highlightAllMatches([]);
      clearHighlightedPath();
    } else if (matches.length === 1) {
      // Single match - focus directly and show details
      isShowingDetails = true;
      focusNode(matches[0]);
      showNodeDetails(matches[0]);
      // setHighlightedPath is called in focusNode
    } else {
      // Multiple matches - show list
      // Set highlighted path to first match so Focus View can work
      setHighlightedPath(matches[0]);
      showSearchResultsList();
    }
  }

  if (searchBtn) searchBtn.addEventListener('click', runSearch);
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        runSearch();
      } else if (e.key === 'ArrowDown' && currentMatches.length > 0) {
        e.preventDefault();
        currentMatchIndex = currentMatchIndex < 0 ? 0 : Math.min(currentMatchIndex + 1, currentMatches.length - 1);
        const selectedNode = currentMatches[currentMatchIndex];
        // Focus on selected node and highlight only its path
        focusNode(selectedNode);
      } else if (e.key === 'ArrowUp' && currentMatches.length > 0) {
        e.preventDefault();
        currentMatchIndex = currentMatchIndex < 0 ? currentMatches.length - 1 : Math.max(currentMatchIndex - 1, 0);
        const selectedNode = currentMatches[currentMatchIndex];
        // Focus on selected node and highlight only its path
        focusNode(selectedNode);
      }
    });
    // Clear results when input is cleared
    searchInput.addEventListener('input', (e) => {
      if (!e.target.value.trim()) {
        currentMatches = [];
        currentMatchIndex = -1;
        primaryMatchIds = new Set();
        synonymMatchIds = new Set();
        link.classed('highlight', false);
        link.classed('highlight-synonym', false);
        node.select('text').classed('highlight', false);
        node.select('text').classed('highlight-synonym', false);
        clearHighlightedPath();
        if (info) info.clear();
      }
    });
  }
}

