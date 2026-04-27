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
  isSynonymsReady,
  getInvalidNameInfo,
} from './synonyms.js';
import { setHighlightedPath, clearHighlightedPath, setMatchIds } from './viewSwitch.js';

export function setupSearch({
  root,
  link,
  node,
  svg = null,   // D3 SVG selection — for .search-active class
  getLiveLinks = null,   // () => live D3 link selection
  getLiveNodes = null,   // () => live D3 node selection
  info,
  setCurrentRotate,
  updateRotate,
  updateLabelOrientation,
  expandToNode,
  searchPathOnly = false, // when true, search keeps only one focused path visible
  initialQuery = '',
  autoRunSearch = false,
  keepResultsListOnSelect = false,
  deferLocalResultsRendering = false,
  onSearchResults = null, // called after matches are resolved
  onSearchClear = null,  // called when search is cleared (e.g. cull.refresh)
  disableGoToTree = false, // when true, hide "Go to Tree" buttons in results list
  taxagroupid = null,      // current taxon group id — used to show external links (e.g. AlgaeBase for DIA)
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

  // ── Comparison-mode state ────────────────────────────────────────────────
  let isCompareMode = false;
  let compareMatchGroupIds = new Map(); // node id → 1 (q1) or 2 (q2)
  let compareQ1Label = '';
  let compareQ2Label = '';
  let compareQ1Matches = [];
  let compareQ2Matches = [];

  // Helpers to get fresh selections on every call so expand/collapse changes
  // are reflected (avoids stale D3 selections captured at init time).
  function liveLinks() { return getLiveLinks ? getLiveLinks() : link; }
  function liveNodes() { return getLiveNodes ? getLiveNodes() : node; }

  // Enter / exit search-active overlay mode.
  // search-active: dim non-matching nodes + links via CSS.
  function setSearchActive(active) {
    if (svg) svg.classed('search-active', active);
  }

  // Mark nodes that lie on at least one match path with .match-path so the
  // CSS overlay keeps them fully visible.
  function applyMatchPathClass(pathNodeSet) {
    liveNodes().classed('match-path', d => pathNodeSet.has(d));
  }

  function liveNodeLabels() {
    return liveNodes()
      .selectAll('text')
      .filter(function () {
        return !this.classList.contains('toggle') && !this.classList.contains('label-halo');
      });
  }

  // ── findMatchesForTerm ────────────────────────────────────────────────────
  // Runs the full name-search (3 passes) for a single query string.
  // Returns {matches, primaryMatchIds, synonymMatchIds, synonymResolutions}.
  function findMatchesForTerm(qStr) {
    const matches = [];
    const matchedIds = new Set();
    const primaryIds = new Set();
    const synonymIds = new Set();
    const resolutions = new Map();
    const reverseMap = window.__invalidIdToCanonicalId || new Map();
    const lower = qStr.toLowerCase().replace(/^\?+/, '').trim();

    // Pass 1: direct name match
    getAllNodes(root).forEach(n => {
      if ((n.data.name || '').toLowerCase().includes(lower)) {
        if (!matchedIds.has(n.data.id)) {
          matches.push(n); matchedIds.add(n.data.id); primaryIds.add(n.data.id);
        }
      }
    });
    // Pass 2: synonym metadata
    getAllNodes(root).forEach(n => {
      const meta = n.data.synonymMetadata;
      if (!meta) return;
      const matchingSyns = meta.synonyms.filter(s => s.invalid_name.toLowerCase().includes(lower));
      if (matchingSyns.length > 0) {
        const cid = n.data.id;
        if (!matchedIds.has(cid)) { matches.push(n); matchedIds.add(cid); synonymIds.add(cid); }
        const ex = resolutions.get(cid) || [];
        matchingSyns.forEach(syn => {
          if (!ex.some(r => r.invalidId === syn.invalid_id))
            ex.push({
              searchedTerm: qStr, invalidId: syn.invalid_id, invalidName: syn.invalid_name,
              synonymtype: syn.synonymtype ?? '', recdatemodified: syn.recdatemodified ?? ''
            });
        });
        resolutions.set(cid, ex);
      }
    });
    // Pass 3: reverseMap by name
    reverseMap.forEach((canonicalId, key) => {
      if (typeof key !== 'string') return;
      if (!key.includes(lower) || !idToNode.has(canonicalId) || matchedIds.has(canonicalId)) return;
      const cn = idToNode.get(canonicalId);
      matches.push(cn); matchedIds.add(canonicalId); synonymIds.add(canonicalId);
      const synDetail = cn.data.synonymMetadata?.synonyms?.find(s => s.invalid_name.toLowerCase() === key);
      const ex = resolutions.get(canonicalId) || [];
      ex.push({
        searchedTerm: qStr, invalidId: synDetail?.invalid_id ?? null,
        invalidName: synDetail?.invalid_name ?? key,
        synonymtype: synDetail?.synonymtype ?? '', recdatemodified: synDetail?.recdatemodified ?? ''
      });
      resolutions.set(canonicalId, ex);
    });
    return { matches, primaryMatchIds: primaryIds, synonymMatchIds: synonymIds, synonymResolutions: resolutions };
  }

  // ── findLCA ───────────────────────────────────────────────────────────────
  function findLCA(nodeA, nodeB) {
    if (!nodeA || !nodeB) return null;
    const ancestorsA = new Set(nodeA.ancestors().map(n => n.data.id));
    for (const anc of nodeB.ancestors()) { if (ancestorsA.has(anc.data.id)) return anc; }
    return null;
  }

  function resetSearchState() {
    const searchInputEl = document.getElementById('searchInput');
    if (searchInputEl) searchInputEl.value = '';

    currentMatches = [];
    currentMatchIndex = -1;
    isShowingDetails = false;
    primaryMatchIds = new Set();
    synonymMatchIds = new Set();
    synonymResolutions = new Map();

    const ll = liveLinks();
    const ln = liveNodes();
    const labels = liveNodeLabels();
    ll.classed('highlight', false);
    ll.classed('highlight-synonym', false);
    ll.classed('highlight-q1', false);
    ll.classed('highlight-q2', false);
    ll.classed('match-path-link', false);
    ln.classed('match-path', false);
    labels.classed('highlight', false);
    labels.classed('highlight-synonym', false);
    labels.classed('highlight-q1', false);
    labels.classed('highlight-q2', false);
    labels.style('paint-order', null)
          .style('stroke', null)
          .style('stroke-width', null)
          .style('stroke-linejoin', null);
    isCompareMode = false; compareMatchGroupIds = new Map();
    compareQ1Label = ''; compareQ2Label = '';
    compareQ1Matches = []; compareQ2Matches = [];
    if (svg) svg.classed('compare-mode', false);

    setSearchActive(false);
    clearHighlightedPath();
    if (info) info.clear();
    if (onSearchClear) onSearchClear();
  }

  function focusNode(d) {
    if (expandToNode) expandToNode(d);

    setCurrentRotate(90 - (d.x * 180 / Math.PI));
    updateRotate();
    updateLabelOrientation();

    const A = new Set(d.ancestors());
    const ll = liveLinks();
    const ln = liveNodes();
    const labels = liveNodeLabels();

    // Clear multi-match gray structure — now showing a single focused path.
    ll.classed('match-path-link', false);
    ll.classed('highlight-synonym', false);
    ll.classed('highlight', l => A.has(l.source) && A.has(l.target));
    ln.classed('match-path', n => A.has(n));
    labels.classed('highlight-synonym', false);
    labels.classed('highlight', n => n === d);
    setSearchActive(true);
    setHighlightedPath(d);
    if (info) info.show(d);
  }

  function highlightAllMatches(matches) {
    // Expand paths to all matching nodes so they are visible in the tree.
    if (expandToNode && matches.length > 0) {
      matches.forEach(m => expandToNode(m));
    }

    const ll = liveLinks();
    const ln = liveNodes();
    const labels = liveNodeLabels();

    // Clear previous state (including match-path-link from prior multi-match).
    ll.classed('highlight', false);
    ll.classed('highlight-synonym', false);
    ll.classed('highlight-q1', false);
    ll.classed('highlight-q2', false);
    ll.classed('match-path-link', false);
    ln.classed('match-path', false);
    labels.classed('highlight', false);
    labels.classed('highlight-synonym', false);
    labels.classed('highlight-q1', false);
    labels.classed('highlight-q2', false);

    if (matches.length === 0) { setSearchActive(false); return; }

    // ── Comparison mode: blue (q1) / orange (q2) dual-color ─────────────────
    if (isCompareMode && compareQ1Matches.length > 0 && compareQ2Matches.length > 0) {
      if (expandToNode) matches.forEach(m => expandToNode(m));
      const q1Ids = new Set(), q2Ids = new Set();
      compareQ1Matches.forEach(n => n.ancestors().forEach(a => q1Ids.add(a.data.id)));
      compareQ2Matches.forEach(n => n.ancestors().forEach(a => q2Ids.add(a.data.id)));
      const lca = findLCA(compareQ1Matches[0], compareQ2Matches[0]);
      const sharedIds = new Set(lca ? lca.ancestors().map(n => n.data.id) : []);
      if (lca) sharedIds.add(lca.data.id);
      const q1Unique = new Set([...q1Ids].filter(id => !sharedIds.has(id)));
      const q2Unique = new Set([...q2Ids].filter(id => !sharedIds.has(id)));
      const allPathNodes = new Set([...q1Ids, ...q2Ids].map(id => idToNode.get(id)).filter(Boolean));
      applyMatchPathClass(allPathNodes);
      ll.classed('match-path-link', l => sharedIds.has(l.source.data.id) && sharedIds.has(l.target.data.id));
      
      // Highlight and raise q1 links
      ll.filter(l => q1Unique.has(l.target.data.id) && q1Ids.has(l.source.data.id))
        .classed('highlight-q1', true).raise();
      // Highlight and raise q2 links
      ll.filter(l => q2Unique.has(l.target.data.id) && q2Ids.has(l.source.data.id))
        .classed('highlight-q2', true).raise();
      
      // Raise the entire node group for any highlighted path, sorted by depth descending
      // This ensures parent nodes are drawn LAST, putting their long text ON TOP of descendant circles!
      ln.filter(n => q1Ids.has(n.data.id) || q2Ids.has(n.data.id))
        .sort((a, b) => b.depth - a.depth)
        .raise();

      labels.classed('highlight-q1', d => compareMatchGroupIds.get(d.data.id) === 1);
      labels.classed('highlight-q2', d => compareMatchGroupIds.get(d.data.id) === 2);
      
      // Defeat CSS caching by enforcing the white stroke halo directly inline for comparison texts
      labels.filter(d => compareMatchGroupIds.has(d.data.id))
            .style('paint-order', 'stroke fill')
            .style('stroke', 'white')
            .style('stroke-width', '3.5px')
            .style('stroke-linejoin', 'round');

      if (svg) svg.classed('compare-mode', true);
      setSearchActive(true);
      return;
    }

    if (searchPathOnly) {
      const activeMatchIndex = currentMatchIndex >= 0 && currentMatchIndex < matches.length ? currentMatchIndex : 0;
      focusNode(matches[activeMatchIndex]);
      return;
    }

    // Collect all ancestors for primary and synonym matches separately.
    const primaryAncestors = new Set();
    const synonymAncestors = new Set();

    matches.forEach(m => {
      if (primaryMatchIds.has(m.data.id)) {
        m.ancestors().forEach(a => primaryAncestors.add(a));
      }
    });
    matches.forEach(m => {
      if (synonymMatchIds.has(m.data.id)) {
        m.ancestors().forEach(a => synonymAncestors.add(a));
      }
    });

    // All nodes on any match path (union of both ancestor sets + matched nodes).
    const allPathNodes = new Set([...primaryAncestors, ...synonymAncestors]);

    // ── Links ────────────────────────────────────────────────────────────────
    // Mark shared-ancestor links as gray structure (.match-path-link).
    // Do NOT paint blue here — blue is revealed per-result on hover/click,
    // so users see one clear path at a time instead of a tangled bundle.
    ll.classed('match-path-link', l =>
      allPathNodes.has(l.source) && allPathNodes.has(l.target)
    );

    // ── Nodes ────────────────────────────────────────────────────────────────
    // .match-path → keeps node fully visible under .search-active overlay
    applyMatchPathClass(allPathNodes);

    // Highlight only the matched leaf names (not every ancestor) so it's clear
    // which nodes are the actual results vs shared path structure.
    labels.classed('highlight', d => primaryMatchIds.has(d.data.id));
    labels.classed('highlight-synonym', d => synonymMatchIds.has(d.data.id));

    // Activate the dimming overlay.
    setSearchActive(true);
  }

  function selectNodeWithinMatches(d) {
    highlightAllMatches(currentMatches);

    const A = new Set(d.ancestors());
    const ll = liveLinks();
    const ln = liveNodes();
    const labels = liveNodeLabels();
    const isSynonym = synonymMatchIds.has(d.data.id);

    if (isSynonym) {
      ll.filter(l => A.has(l.source) && A.has(l.target)).classed('highlight-synonym', true).raise();
      ll.classed('highlight', false);
      labels.classed('highlight-synonym', n => n === d);
      labels.classed('highlight', false);
    } else {
      ll.filter(l => A.has(l.source) && A.has(l.target)).classed('highlight', true).raise();
      ll.classed('highlight-synonym', false);
      labels.classed('highlight', n => n === d);
      labels.classed('highlight-synonym', false);
    }
    
    // Raise the node groups to stay above links and sibling unhighlighted nodes, sorted nicely
    ln.filter(n => A.has(n))
      .sort((a, b) => b.depth - a.depth)
      .raise();
    
    // Fallback inline styling to guarantee text halo only on focused leaf
    labels.filter(n => n === d)
          .style('paint-order', 'stroke fill')
          .style('stroke', 'white')
          .style('stroke-width', '3.5px')
          .style('stroke-linejoin', 'round');

    setSearchActive(true);
    setHighlightedPath(d);
    if (info) info.show(d);
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

      // Add "Go to Tree" button if node has children and we're not in collapsible-tree context
      const hasChildren = m.children && m.children.length > 0;
      const goToTreeBtn = !disableGoToTree && hasChildren && window.navigateToNode ? `
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
      if (idx === currentMatchIndex && keepResultsListOnSelect) {
        item.style.backgroundColor = '#e8f5e9';
      }
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking the "Go to Tree" button
        if (e.target.classList.contains('go-to-tree-btn')) {
          return;
        }
        currentMatchIndex = idx;
        const selectedNode = currentMatches[idx];
        if (keepResultsListOnSelect) {
          if (currentMatches.length > 1) {
            selectNodeWithinMatches(selectedNode);
          } else {
            focusNode(selectedNode);
          }
          showSearchResultsList();
        } else {
          focusNode(selectedNode);
          isShowingDetails = true;
          showNodeDetails(selectedNode);
        }
      });
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f3f4f6';
        // Temporarily reveal this single result's path in the tree as blue.
        const m = currentMatches[idx];
        const A = new Set(m.ancestors());
        const ll = liveLinks();
        const isSynonym = synonymMatchIds.has(m.data.id);
        if (isSynonym) {
          ll.classed('highlight-synonym', l => A.has(l.source) && A.has(l.target));
        } else {
          ll.classed('highlight', l => A.has(l.source) && A.has(l.target));
        }
      });
      item.addEventListener('mouseleave', () => {
        if (idx === currentMatchIndex && keepResultsListOnSelect) {
          item.style.backgroundColor = '#e8f5e9';
          if (currentMatches[currentMatchIndex]) {
            if (currentMatches.length > 1) {
              selectNodeWithinMatches(currentMatches[currentMatchIndex]);
            } else {
              focusNode(currentMatches[currentMatchIndex]);
            }
          }
        } else {
          item.style.backgroundColor = 'transparent';
          // Revert to the neutral gray match-path-link state.
          const ll = liveLinks();
          ll.classed('highlight', false);
          ll.classed('highlight-synonym', false);
        }
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

    // ── Case 2: user searched an INVALID synonym name ────────────────────────
    // Clearly tells the user what they searched is not valid,
    // why it's invalid, and what the correct accepted name is.
    let resolutionBanner = '';
    const resolutions = synonymResolutions.get(nodeId);
    if (resolutions && resolutions.length > 0) {
      resolutionBanner = resolutions.map(r => `
        <div style="
          margin-top:10px; padding:10px 14px;
          background:#fff7ed; border-left:3px solid #f97316; border-radius:4px;
        ">
          <div style="font-weight:700;font-size:13px;color:#c2410c;margin-bottom:6px;">
            ⚠️ "<span style="font-style:italic;">${r.invalidName}</span>" is not the currently accepted name
          </div>
          ${r.synonymtype ? `
            <div style="font-size:12px;color:#7c3a1e;margin-bottom:4px;">
              <strong>Reason:</strong> ${r.synonymtype}
            </div>
          ` : ''}
          ${r.recdatemodified ? `
            <div style="font-size:12px;color:#9a3412;margin-bottom:6px;">
              <strong>Last updated:</strong> ${formatDate(r.recdatemodified)}
            </div>
          ` : ''}
          <div style="font-size:13px;color:#1f2937;margin-top:6px;padding-top:6px;border-top:1px solid #fed7aa;">
            The currently accepted name is:
            <strong style="color:#15803d;">${selectedNode.data.name}</strong>
          </div>
        </div>
      `).join('');
    }

    // ── Cross-check: canonical node whose name is ALSO listed as invalid ───────
    // This catches the case where Neotoma has "Aulacoseira distans var. humilis"
    // both as a valid taxon (with occurrence records) AND as a synonym of
    // "Aulacoseira humilis". The user searched the valid Neotoma name but the
    // taxonomic literature considers it invalid.
    if (!resolutionBanner) {
      const invalidInfo = getInvalidNameInfo(selectedNode.data.name);
      if (invalidInfo) {
        resolutionBanner = `
          <div style="
            margin-top:10px; padding:10px 14px;
            background:#fff7ed; border-left:3px solid #f97316; border-radius:4px;
          ">
            <div style="font-weight:700;font-size:13px;color:#c2410c;margin-bottom:6px;">
              ⚠️ "<span style="font-style:italic;">${selectedNode.data.name}</span>" is listed as an invalid name in current taxonomy
            </div>
            ${invalidInfo.synonymtype ? `
              <div style="font-size:12px;color:#7c3a1e;margin-bottom:4px;">
                <strong>Reason:</strong> ${invalidInfo.synonymtype}
              </div>
            ` : ''}
            ${invalidInfo.recdatemodified ? `
              <div style="font-size:12px;color:#9a3412;margin-bottom:6px;">
                <strong>Last updated:</strong> ${formatDate(invalidInfo.recdatemodified)}
              </div>
            ` : ''}
            <div style="font-size:13px;color:#1f2937;margin-top:6px;padding-top:6px;border-top:1px solid #fed7aa;">
              The currently accepted name is:
              <strong style="color:#15803d;">${invalidInfo.validName}</strong>
            </div>
            <div style="font-size:11px;color:#9a3412;margin-top:6px;font-style:italic;">
              Note: this taxon has occurrence records in Neotoma under this name. The accepted name above reflects current taxonomic consensus.
            </div>
          </div>
        `;
      }
    }

    // ── Case 1: user searched the VALID name, node has known synonyms ─────────
    // Confirms the searched name is correct, and shows what it used to be called.
    let synonymSection = '';
    const meta = selectedNode.data.synonymMetadata;
    if (meta && meta.synonyms && meta.synonyms.length > 0) {
      synonymSection = `
        <div style="
          margin-top:12px; padding:10px 14px;
          background:#f0fdf4; border-left:3px solid #16a34a; border-radius:4px;
        ">
          <div style="font-weight:700;font-size:13px;color:#15803d;margin-bottom:4px;">
            ✓ <em>${selectedNode.data.name}</em> is the currently accepted name
          </div>
          <div style="font-size:12px;color:#4b7c59;margin-bottom:8px;">
            This taxon was previously known by the following name${meta.synonyms.length > 1 ? 's' : ''}:
          </div>
          ${meta.synonyms.map(syn => `
            <div style="padding:6px 0;border-top:1px solid #bbf7d0;margin-top:2px;">
              <div style="font-weight:600;color:#b45309;font-size:13px;">
                • <em>${syn.invalid_name}</em>
                <span style="font-size:11px;color:#dc2626;font-weight:400;margin-left:6px;">now invalid</span>
              </div>
              <div style="font-size:11px;color:#6b7280;margin-left:14px;margin-top:2px;">
                ${syn.synonymtype ? `Reason: ${syn.synonymtype}` : ''}
                ${syn.synonymtype && syn.recdatemodified ? ' · ' : ''}
                ${syn.recdatemodified ? 'Last updated: ' + formatDate(syn.recdatemodified) : ''}
              </div>
            </div>
          `).join('')}
          <div style="font-size:11px;color:#9ca3af;margin-top:8px;font-style:italic;">
            Synonym data from the Neotoma Paleoecology Database.
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

    // ── AlgaeBase external link ───────────────────────────────────────────────
    // Shown for DIA (Diatoms) when the selected node is a species-level taxon
    // (binomial name — 2 or more words, not an Undetermined/Unknown synthetic node).
    let algaeBaseLink = '';
    const ALGAEBASE_GROUPS = new Set(['DIA']);
    const nodeName = selectedNode.data.name || '';
    const wordCount = nodeName.trim().split(/\s+/).length;
    const isSyntheticOrUncertain = nodeName.toLowerCase().startsWith('undetermined')
      || nodeName.toLowerCase().startsWith('unknown')
      || selectedNode.data.isSyntheticGroup;
    if (ALGAEBASE_GROUPS.has(taxagroupid) && wordCount >= 2 && !isSyntheticOrUncertain) {
      const algaeBaseUrl = 'https://www.algaebase.org/search/species/?name='
        + nodeName.trim().replace(/\s+/g, '+') + '&authority=';
      algaeBaseLink = `
        <div style="margin-top:12px;">
          <a href="${algaeBaseUrl}" target="_blank" rel="noopener noreferrer" style="
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 13px;
            color: #1565c0;
            text-decoration: none;
            padding: 5px 10px;
            border: 1px solid #bbdefb;
            border-radius: 6px;
            background: #f0f7ff;
            transition: background 0.15s;
          " onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#f0f7ff'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1565c0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Search this species in AlgaeBase
          </a>
        </div>
      `;
    }

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">Search Results (${currentMatches.length} matches)</div>
      <div style="margin-bottom:8px;"><strong>Path:</strong> ${names.map(n => `<div style="margin-left:12px;">${n}</div>`).join('')}</div>
      ${resolutionBanner}
      ${synonymSection}
      ${algaeBaseLink}
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

  // ── showComparisonPanel ─────────────────────────────────────────────────
  function showComparisonPanel(q1Label, q2Label, q1Matches, q2Matches) {
    const panel = document.getElementById('info');
    if (!panel) return;
    const missing = q1Matches.length === 0 ? q1Label : (q2Matches.length === 0 ? q2Label : null);
    if (missing) {
      panel.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">Comparison</div>
        <div style="color:#c2410c;">No matches found for "<em>${missing}</em>".</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">Check spelling or try a different taxon group.</div>`;
      panel.style.display = 'block'; return;
    }
    const node1 = q1Matches[0], node2 = q2Matches[0];
    const lca = findLCA(node1, node2);
    const path1 = node1.ancestors().reverse().map(n => n.data.name);
    const path2 = node2.ancestors().reverse().map(n => n.data.name);
    const lcaDepth = lca ? lca.depth : -1;
    const div1 = lcaDepth >= 0 ? path1.slice(lcaDepth + 1) : path1;
    const div2 = lcaDepth >= 0 ? path2.slice(lcaDepth + 1) : path2;
    panel.innerHTML = `
      <div style="font-weight:700;font-size:14px;margin-bottom:10px;color:#1f2937;">Comparing Two Taxa</div>
      ${lca ? `
        <div style="margin-bottom:10px;padding:8px 12px;background:#f0fdf4;border-left:3px solid #16a34a;border-radius:4px;">
          <div style="font-size:11px;color:#4b7c59;font-weight:700;margin-bottom:3px;">SHARED ANCESTOR</div>
          <div style="font-weight:700;font-size:14px;color:#15803d;">${lca.data.name}</div>
          ${div1.length > 0
          ? `<div style="font-size:11px;color:#6b7280;margin-top:4px;">Diverges at: <strong>${div1[0]}</strong> / <strong>${div2[0] || '?'}</strong></div>`
          : '<div style="font-size:11px;color:#6b7280;margin-top:4px;">Paths are identical</div>'}
        </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="padding:8px 10px;background:#eff6ff;border-left:3px solid #1d4ed8;border-radius:4px;">
          <div style="font-size:11px;color:#1d4ed8;font-weight:700;margin-bottom:5px;">🔵 ${q1Label}</div>
          ${div1.length > 0
        ? div1.map(n => `<div style="font-size:12px;color:#1e3a8a;padding:1px 0 1px 8px;">${n}</div>`).join('')
        : '<div style="font-size:12px;color:#6b7280;font-style:italic;">(same as shared ancestor)</div>'}
          ${q1Matches.length > 1 ? `<div style="font-size:10px;color:#6b7280;margin-top:4px;">+${q1Matches.length - 1} more</div>` : ''}
        </div>
        <div style="padding:8px 10px;background:#fff7ed;border-left:3px solid #c2410c;border-radius:4px;">
          <div style="font-size:11px;color:#c2410c;font-weight:700;margin-bottom:5px;">🟠 ${q2Label}</div>
          ${div2.length > 0
        ? div2.map(n => `<div style="font-size:12px;color:#7c2d12;padding:1px 0 1px 8px;">${n}</div>`).join('')
        : '<div style="font-size:12px;color:#6b7280;font-style:italic;">(same as shared ancestor)</div>'}
          ${q2Matches.length > 1 ? `<div style="font-size:10px;color:#6b7280;margin-top:4px;">+${q2Matches.length - 1} more</div>` : ''}
        </div>
      </div>
      <div style="font-size:11px;color:#9ca3af;margin-top:8px;">
        🔵 ${q1Matches.length} match(es) · 🟠 ${q2Matches.length} match(es)
      </div>
    `;
    panel.style.display = 'block';
  }

  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  async function runSearch() {
    if (!searchInput) return;
    const q = searchInput.value.trim();
    if (info) info.clear();
    if (!q) { resetSearchState(); return; }

    // ── Comparison mode: comma-separated two queries ────────────────────────
    const parts = q.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const r1 = findMatchesForTerm(parts[0]);
      const r2 = findMatchesForTerm(parts[1]);
      const allMatches = [...r1.matches, ...r2.matches];
      const groupIds = new Map();
      r1.matches.forEach(n => groupIds.set(n.data.id, 1));
      r2.matches.forEach(n => { if (!groupIds.has(n.data.id)) groupIds.set(n.data.id, 2); });
      isCompareMode = true;
      compareMatchGroupIds = groupIds;
      compareQ1Label = parts[0]; compareQ2Label = parts[1];
      compareQ1Matches = r1.matches; compareQ2Matches = r2.matches;
      currentMatches = allMatches;
      primaryMatchIds = new Set([...r1.primaryMatchIds, ...r2.primaryMatchIds]);
      synonymMatchIds = new Set([...r1.synonymMatchIds, ...r2.synonymMatchIds]);
      synonymResolutions = new Map([...r1.synonymResolutions, ...r2.synonymResolutions]);
      currentMatchIndex = -1;
      setMatchIds(new Set([...primaryMatchIds, ...synonymMatchIds]));
      if (allMatches.length > 0 && onSearchResults) {
        await onSearchResults({ matches: allMatches, primaryMatchIds, synonymMatchIds });
      }
      highlightAllMatches(allMatches);
      showComparisonPanel(compareQ1Label, compareQ2Label, compareQ1Matches, compareQ2Matches);
      return;
    }

    // Single query — reset comparison state
    isCompareMode = false; compareMatchGroupIds = new Map();
    compareQ1Label = ''; compareQ2Label = '';
    compareQ1Matches = []; compareQ2Matches = [];

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

    if (matches.length > 0 && onSearchResults) {
      await onSearchResults({
        matches,
        primaryMatchIds: new Set(primaryMatchIds),
        synonymMatchIds: new Set(synonymMatchIds),
      });
    }

    if (matches.length > 0 && deferLocalResultsRendering) {
      return;
    }

    if (matches.length === 0) {
      if (info) {
        const panel = document.getElementById('info');
        if (panel) {
          panel.innerHTML = `
                <div style="font-weight:600;margin-bottom:6px;">Search Results</div>
                <div style="color:#6b7280;margin-bottom:8px;">No matches found for "<em>${q}</em>".</div>
                <div style="font-size:12px;color:#6b7280;background:#f3f4f6;border-radius:6px;padding:8px 10px;line-height:1.5;">
                  💡 <strong>Tip:</strong> If you are searching for a taxon below Class level (e.g., order, family, genus, or species), try selecting a <strong>Taxon Group</strong> from the dropdown first, then search again.
                </div>
              `;
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
      currentMatchIndex = keepResultsListOnSelect ? -1 : 0;
      if (searchPathOnly) {
        focusNode(matches[0]);
      }
      showSearchResultsList();
    }
  }

  if (searchBtn) searchBtn.addEventListener('click', runSearch);
  if (searchInput) {
    if (initialQuery && !searchInput.value.trim()) {
      searchInput.value = initialQuery;
    }
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
        resetSearchState();
      }
    });
  }

  if (autoRunSearch) {
    runSearch();
  }

  return { resetSearchState, runSearch };
}
