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
} from './synonyms.js';
import { setHighlightedPath, clearHighlightedPath, setMatchIds } from './viewSwitch.js';
import { fetchAndRenderExternalLinks } from './externaltaxa.js';
import { fetchAndRenderTaxonMetadata } from './taxonMetadata.js';
import { fetchAndRenderTaxonSummary } from './taxonSummary.js';
import { updateURLState } from './urlhash.js';
import { splitSearchQuery, unwrapQuotedSearchTerm } from './searchQuery.js';
import {
  buildTaxonAutocompleteCandidates,
  getTaxonAutocompleteSuggestions,
} from './taxonAutocomplete.js';

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
  autoFocusMatchThreshold = null,
  hideAncestorLabelsOnSelect = false,
  onSearchResults = null, // called after matches are resolved
  onAutoFocusManyMatches = null,
  setSearchRenderPreference = null,
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
  
  const currentSearchDetailIdRef = { value: null }; // Track current detail view ID for async fetch

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

  function clearSelectedPathAncestorLabelState() {
    liveNodeLabels().classed('path-context-hidden', false);
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
    const raw = qStr.trim();
    const exactMatch = raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")));
    const lower = exactMatch
      ? raw.slice(1, -1).toLowerCase().trim()
      : raw.toLowerCase().replace(/^\?+/, '').trim();

    // Pass 1: direct name match
    getAllNodes(root).forEach(n => {
      const nodeName = (n.data.name || '').toLowerCase();
      const isMatch = exactMatch ? nodeName === lower : nodeName.includes(lower);
      if (isMatch) {
        if (!matchedIds.has(n.data.id)) {
          matches.push(n); matchedIds.add(n.data.id); primaryIds.add(n.data.id);
        }
      }
    });
    // Pass 2: synonym metadata
    getAllNodes(root).forEach(n => {
      const meta = n.data.synonymMetadata;
      if (!meta) return;
      const matchingSyns = meta.synonyms.filter(s => {
        const invalidName = s.invalid_name.toLowerCase();
        return exactMatch ? invalidName === lower : invalidName.includes(lower);
      });
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
      const keyMatches = exactMatch ? key === lower : key.includes(lower);
      if (!keyMatches || !idToNode.has(canonicalId) || matchedIds.has(canonicalId)) return;
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
    
    // Update URL hash state
    updateURLState({ q: null });

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
    clearSelectedPathAncestorLabelState();
    labels.style('paint-order', null)
          .style('stroke', null)
          .style('stroke-width', null)
          .style('stroke-linejoin', null);
    isCompareMode = false; compareMatchGroupIds = new Map();
    compareQ1Label = ''; compareQ2Label = '';
    compareQ1Matches = []; compareQ2Matches = [];
    if (svg) svg.classed('compare-mode', false);

    setSearchActive(false);
    if (setSearchRenderPreference) setSearchRenderPreference(false);
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
    clearSelectedPathAncestorLabelState();
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
    clearSelectedPathAncestorLabelState();
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

    // Once a specific search result is selected, keep only that path visible in
    // the search overlay so dense groups like Algae do not show overlapping
    // labels from sibling matches behind the chosen result.
    applyMatchPathClass(A);
    ll.classed('match-path-link', l => A.has(l.source) && A.has(l.target));
    clearSelectedPathAncestorLabelState();
    if (hideAncestorLabelsOnSelect) {
      labels.classed('path-context-hidden', n => A.has(n) && n !== d);
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
      <div style="font-weight:600;margin-bottom:6px;">Search Results (${currentMatches.length} matched paths)</div>
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
          if (currentMatches.length > 1) {
            selectNodeWithinMatches(selectedNode);
          } else {
            focusNode(selectedNode);
          }
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
    currentSearchDetailIdRef.value = nodeId; // Set for async fetch race-condition check

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

    const formatDate = (dateStr) => {
      if (!dateStr) return 'N/A';
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // ── Case 2: user searched a name that Neotoma maps to another accepted name ─
    // Keep the wording scoped to Neotoma's taxonomy records instead of implying
    // global taxonomic consensus across all authorities.
    let resolutionBanner = '';
    const matchedDirectly = primaryMatchIds.has(nodeId);
    const resolutions = synonymResolutions.get(nodeId);
    if (!matchedDirectly && resolutions && resolutions.length > 0) {
      resolutionBanner = resolutions.map(r => `
        <div style="
          margin-top:10px; padding:10px 14px;
          background:#fff7ed; border-radius:4px;
        ">
          <div style="font-size:13px;color:#1f2937;line-height:1.5;">
            <strong style="color:#9a3412;">Accepted name in Neotoma:</strong> <span style="color:#15803d;font-weight:600;">${selectedNode.data.name}</span>
          </div>
          <div style="font-size:13px;color:#1f2937;line-height:1.5;margin-top:2px;">
            <strong style="color:#9a3412;">Synonym:</strong> <span style="color:#b45309;font-style:italic;">${r.invalidName}</span>
          </div>
          ${(r.synonymtype || r.recdatemodified) ? `
            <div style="font-size:12px;color:#7c3a1e;line-height:1.45;margin-top:4px;">
              ${r.synonymtype ? `<strong>Type:</strong> ${r.synonymtype}` : ''}
              ${r.synonymtype && r.recdatemodified ? ' · ' : ''}
              ${r.recdatemodified ? `<strong>Updated:</strong> ${formatDate(r.recdatemodified)}` : ''}
            </div>
          ` : ''}
          <div style="font-size:11px;color:#9a3412;margin-top:6px;line-height:1.45;">
            Synonym status shown here reflects Neotoma taxonomy records and may differ from other taxonomic authorities.
          </div>
        </div>
      `).join('');
    }

    // ── Case 1: user searched a Neotoma accepted name with known synonyms ─────
    // Present synonym status as Neotoma's record state, not a universal judgment.
    let synonymSection = '';
    const meta = selectedNode.data.synonymMetadata;
    if (!resolutionBanner && meta && meta.synonyms && meta.synonyms.length > 0) {
      synonymSection = `
        <div style="
          margin-top:12px; padding:10px 14px;
          background:#f0fdf4; border-radius:4px;
        ">
          <div style="font-size:13px;color:#1f2937;line-height:1.5;">
            <strong style="color:#15803d;">Accepted name in Neotoma:</strong> <span style="color:#15803d;font-weight:600;">${selectedNode.data.name}</span>
          </div>
          ${meta.synonyms.map((syn, index) => `
            <div style="font-size:13px;color:#1f2937;line-height:1.5;${index === 0 ? 'margin-top:2px;' : 'margin-top:4px;'}">
              <strong style="color:#15803d;">${meta.synonyms.length > 1 ? `Synonym ${index + 1}` : 'Synonym'}:</strong> <span style="color:#b45309;font-style:italic;">${syn.invalid_name}</span>
            </div>
            ${(syn.synonymtype || syn.recdatemodified) ? `
              <div style="font-size:12px;color:#4b5563;line-height:1.45;margin-top:2px;">
                ${syn.synonymtype ? `<strong>Type:</strong> ${syn.synonymtype}` : ''}
                ${syn.synonymtype && syn.recdatemodified ? ' · ' : ''}
                ${syn.recdatemodified ? `<strong>Updated:</strong> ${formatDate(syn.recdatemodified)}` : ''}
              </div>
            ` : ''}
          `).join('')}
          <div style="font-size:11px;color:#6b7280;margin-top:6px;line-height:1.45;">
            Synonym status shown here reflects Neotoma taxonomy records and may differ from other taxonomic authorities.
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
        font-family: 'Figtree', sans-serif;
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
        font-family: 'Figtree', sans-serif;
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

    const detailHeader = currentMatches.length > 1
      ? `Search Result (1 of ${currentMatches.length} matched paths)`
      : 'Search Result';

    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">${detailHeader}</div>
      <div style="margin-bottom:8px;"><strong>Path:</strong> ${pathHtml}</div>
      <div id="taxon-metadata-container"></div>
      <div id="taxon-summary-container"></div>
      ${resolutionBanner}
      ${synonymSection}
      ${algaeBaseLink}
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        ${backButton}
        ${goToTreeButton}
      </div>
    `;
    panel.style.display = 'block';

    const metadataContainer = document.getElementById('taxon-metadata-container');
    if (metadataContainer && currentSearchDetailIdRef.value) {
      fetchAndRenderTaxonMetadata(currentSearchDetailIdRef.value, metadataContainer, currentSearchDetailIdRef);
    }

    const summaryContainer = document.getElementById('taxon-summary-container');
    if (summaryContainer && currentSearchDetailIdRef.value && taxagroupid) {
      fetchAndRenderTaxonSummary(currentSearchDetailIdRef.value, taxagroupid, summaryContainer, currentSearchDetailIdRef);
    }

    // Fetch and render external links dynamically
    const extLinksContainer = document.getElementById('ext-links-container');
    if (extLinksContainer && currentSearchDetailIdRef.value) {
      fetchAndRenderExternalLinks(currentSearchDetailIdRef.value, extLinksContainer, currentSearchDetailIdRef);
    }

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
    const lcaPath = lca ? lca.ancestors().reverse().map(n => n.data.name) : [];
    const lcaHtml = lcaPath.map((n, i) => i === lcaPath.length - 1
      ? `<strong class="cmp-ancestor-lca">${n}</strong>`
      : n).join('<span class="cmp-arrow">→</span>');

    panel.innerHTML = `
      <div class="cmp-wrapper">
        <div class="cmp-heading">Comparing Two Taxa</div>
        ${lca ? `
        <div class="cmp-ancestor">
          <div class="cmp-ancestor-badge">SHARED ANCESTOR</div>
          <div class="cmp-ancestor-path">${lcaHtml}</div>
          ${div1.length > 0
            ? `<div class="cmp-diverge">Diverges at: <strong>${div1[0]}</strong> / <strong>${div2[0] || '?'}</strong></div>`
            : '<div class="cmp-diverge">Paths are identical</div>'}
        </div>` : ''}
        <div class="cmp-grid">
          <div class="cmp-col cmp-col-q1">
            <div class="cmp-col-header">
              <span class="cmp-dot cmp-dot-q1"></span>
              <span class="cmp-col-label">${q1Label}</span>
            </div>
            ${div1.length > 0
              ? div1.map(n => `<div class="cmp-item">${n}</div>`).join('')
              : '<div class="cmp-item cmp-item-empty">(same as shared ancestor)</div>'}
          </div>
          <div class="cmp-col cmp-col-q2">
            <div class="cmp-col-header">
              <span class="cmp-dot cmp-dot-q2"></span>
              <span class="cmp-col-label">${q2Label}</span>
            </div>
            ${div2.length > 0
              ? div2.map(n => `<div class="cmp-item">${n}</div>`).join('')
              : '<div class="cmp-item cmp-item-empty">(same as shared ancestor)</div>'}
          </div>
        </div>
        <div class="cmp-footer">
          <span class="cmp-match-badge cmp-match-q1">${q1Matches.length} match(es)</span>
          <span class="cmp-match-badge cmp-match-q2">${q2Matches.length} match(es)</span>
        </div>
      </div>
    `;
    panel.style.display = 'block';
  }

  function showCompareDisambiguationPanel(q1Label, q2Label, q1Matches, q2Matches) {
    const panel = document.getElementById('info');
    if (!panel) return;

    function quoteExactTaxonName(name) {
      return `"${String(name || '').replace(/"/g, '\\"')}"`;
    }

    function renderSide(label, matches, sideClass) {
      if (matches.length === 0) {
        return `
          <div class="cmp-resolve-card ${sideClass}">
            <div class="cmp-resolve-label">${label}</div>
            <div class="cmp-resolve-empty">No matching taxon found. Check spelling or choose a different taxon group.</div>
          </div>
        `;
      }

      if (matches.length === 1) {
        const only = matches[0];
        const path = only.ancestors().reverse().map(n => n.data.name).join(' → ');
        return `
          <div class="cmp-resolve-card ${sideClass}">
            <div class="cmp-resolve-label">${label}</div>
            <div class="cmp-resolve-selected">${only.data.name}</div>
            <div class="cmp-resolve-path">${path}</div>
          </div>
        `;
      }

      return `
        <div class="cmp-resolve-card ${sideClass}">
          <div class="cmp-resolve-label">${label}</div>
          <div class="cmp-resolve-empty">${matches.length} matches found. Choose one exact taxon to compare.</div>
          <div class="cmp-resolve-list">
            ${matches.map((match, index) => {
              const path = match.ancestors().reverse().map(n => n.data.name).join(' → ');
              return `
                <button class="cmp-resolve-option" type="button" data-query-side="${label === q1Label ? 'q1' : 'q2'}" data-match-index="${index}">
                  <span class="cmp-resolve-name">${match.data.name}</span>
                  <span class="cmp-resolve-path">${path}</span>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    panel.innerHTML = `
      <div class="cmp-wrapper">
        <div class="cmp-heading">Choose Exact Taxa to Compare</div>
        <div class="cmp-resolve-note">
          Comparison requires one specific taxon on each side. Refine any query with multiple matches before comparing.
        </div>
        <div class="cmp-resolve-grid">
          ${renderSide(q1Label, q1Matches, 'cmp-resolve-q1')}
          ${renderSide(q2Label, q2Matches, 'cmp-resolve-q2')}
        </div>
      </div>
    `;
    panel.style.display = 'block';

    panel.querySelectorAll('.cmp-resolve-option').forEach(button => {
      button.addEventListener('click', () => {
        const side = button.getAttribute('data-query-side');
        const matchIndex = Number(button.getAttribute('data-match-index'));
        const selected = side === 'q1' ? q1Matches[matchIndex] : q2Matches[matchIndex];
        if (!selected) return;
        const nextQ1 = side === 'q1'
          ? quoteExactTaxonName(selected.data.name)
          : (q1Matches.length === 1 ? quoteExactTaxonName(q1Matches[0].data.name) : q1Label);
        const nextQ2 = side === 'q2'
          ? quoteExactTaxonName(selected.data.name)
          : (q2Matches.length === 1 ? quoteExactTaxonName(q2Matches[0].data.name) : q2Label);
        if (searchInput) {
          searchInput.value = `${nextQ1}, ${nextQ2}`;
        }
        runSearch();
      });
    });
  }

  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const autocompleteCandidates = buildTaxonAutocompleteCandidates(root);
  let autocompleteSuggestions = [];
  let autocompleteIndex = -1;
  let autocompleteTimer = null;
  let autocompleteList = null;

  function closeAutocomplete() {
    if (autocompleteTimer) {
      window.clearTimeout(autocompleteTimer);
      autocompleteTimer = null;
    }
    autocompleteSuggestions = [];
    autocompleteIndex = -1;
    if (autocompleteList) autocompleteList.hidden = true;
    if (searchInput) searchInput.setAttribute('aria-expanded', 'false');
  }

  function renderAutocomplete() {
    if (!autocompleteList || !searchInput) return;
    if (autocompleteSuggestions.length === 0) {
      closeAutocomplete();
      return;
    }

    autocompleteList.innerHTML = autocompleteSuggestions.map((suggestion, index) => {
      const active = index === autocompleteIndex;
      const synonym = suggestion.isSynonym
        ? `<span class="taxon-autocomplete-synonym">Synonym: ${suggestion.term}</span>`
        : '';
      return `<button type="button" role="option" aria-selected="${active}" class="taxon-autocomplete-option${active ? ' active' : ''}" data-index="${index}">
        <span class="taxon-autocomplete-name">${suggestion.canonicalName}</span>${synonym}
      </button>`;
    }).join('');
    autocompleteList.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    autocompleteList.querySelectorAll('.taxon-autocomplete-option').forEach((option) => {
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => selectAutocompleteSuggestion(Number(option.dataset.index)));
    });
  }

  function selectAutocompleteSuggestion(index) {
    const suggestion = autocompleteSuggestions[index];
    if (!suggestion || !searchInput) return;
    // Quotes preserve the existing comparison syntax for taxa whose names contain commas.
    searchInput.value = suggestion.canonicalName.includes(',')
      ? `"${suggestion.canonicalName}"`
      : suggestion.canonicalName;
    closeAutocomplete();
    runSearch();
  }

  function scheduleAutocomplete() {
    if (!searchInput) return;
    const query = searchInput.value.trim();
    // A comma starts comparison mode. Suggestions intentionally stay scoped to
    // one taxon, so comparison parsing remains unchanged.
    if (!query || splitSearchQuery(query).length > 1) {
      closeAutocomplete();
      return;
    }
    if (autocompleteTimer) window.clearTimeout(autocompleteTimer);
    autocompleteTimer = window.setTimeout(() => {
      autocompleteSuggestions = getTaxonAutocompleteSuggestions(autocompleteCandidates, query);
      autocompleteIndex = -1;
      renderAutocomplete();
    }, 120);
  }

  async function runSearch() {
    if (!searchInput) return;
    const q = searchInput.value.trim();
    if (setSearchRenderPreference) setSearchRenderPreference(false);
    
    // Update URL hash state
    updateURLState({ q: q || null });
    
    if (info) info.clear();
    if (!q) { resetSearchState(); return; }

    // ── Comparison mode: comma-separated two queries ────────────────────────
    const parts = splitSearchQuery(q);
    if (parts.length >= 2) {
      const r1 = findMatchesForTerm(parts[0]);
      const r2 = findMatchesForTerm(parts[1]);

      if (r1.matches.length !== 1 || r2.matches.length !== 1) {
        isCompareMode = false;
        compareMatchGroupIds = new Map();
        compareQ1Label = parts[0]; compareQ2Label = parts[1];
        compareQ1Matches = []; compareQ2Matches = [];
        currentMatches = [];
        primaryMatchIds = new Set();
        synonymMatchIds = new Set();
        synonymResolutions = new Map();
        currentMatchIndex = -1;
        setMatchIds(new Set());
        clearHighlightedPath();
        highlightAllMatches([]);
        showCompareDisambiguationPanel(parts[0], parts[1], r1.matches, r2.matches);
        return;
      }

      const node1 = r1.matches[0];
      const node2 = r2.matches[0];
      const allMatches = [node1, node2];
      const groupIds = new Map([[node1.data.id, 1], [node2.data.id, 2]]);
      isCompareMode = true;
      compareMatchGroupIds = groupIds;
      compareQ1Label = node1.data.name; compareQ2Label = node2.data.name;
      compareQ1Matches = [node1]; compareQ2Matches = [node2];
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

    const singleQuery = unwrapQuotedSearchTerm(parts[0] ?? q);
    let matches = [];
    const matchedIds = new Set();
    primaryMatchIds = new Set();
    synonymMatchIds = new Set();
    synonymResolutions = new Map(); // Reset per search

    // Helper: resolve an invalid ID to its canonical node (if in tree)
    const reverseMap = window.__invalidIdToCanonicalId || new Map();

    const numericId = Number(singleQuery);
    const isIdSearch = !Number.isNaN(numericId) && Number.isInteger(numericId) && singleQuery !== '';

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
            searchedTerm: singleQuery,
            invalidId: numericId,
            invalidName: synDetail?.invalid_name ?? String(numericId),
            synonymtype: synDetail?.synonymtype ?? '',
            recdatemodified: synDetail?.recdatemodified ?? ''
          }]);
        }
      }
    } else {
      // ── Name search ────────────────────────────────────────────────────────
      const lower = singleQuery.toLowerCase().replace(/^\?+/, '').trim(); // strip leading ? (uncertain name notation)

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
                searchedTerm: singleQuery,
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
            searchedTerm: singleQuery,
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
      if (autoFocusMatchThreshold != null &&
          matches.length > autoFocusMatchThreshold &&
          onAutoFocusManyMatches) {
        await onAutoFocusManyMatches({
          matches,
          primaryMatchIds: new Set(primaryMatchIds),
          synonymMatchIds: new Set(synonymMatchIds),
        });
      }
    }
  }

  if (searchBtn) searchBtn.addEventListener('click', runSearch);
  if (searchInput) {
    searchInput.__taxonAutocompleteCleanup?.();
    const searchSection = searchInput.closest('.search-section');
    if (searchSection) {
      autocompleteList = document.createElement('div');
      autocompleteList.id = 'taxonAutocompleteList';
      autocompleteList.className = 'taxon-autocomplete-list';
      autocompleteList.setAttribute('role', 'listbox');
      autocompleteList.hidden = true;
      searchSection.appendChild(autocompleteList);
      searchInput.setAttribute('role', 'combobox');
      searchInput.setAttribute('aria-autocomplete', 'list');
      searchInput.setAttribute('aria-controls', autocompleteList.id);
      searchInput.setAttribute('aria-expanded', 'false');
    }

    const onAutocompleteKeyDown = (e) => {
      if (autocompleteSuggestions.length === 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        autocompleteIndex = (autocompleteIndex + direction + autocompleteSuggestions.length) % autocompleteSuggestions.length;
        renderAutocomplete();
      } else if (e.key === 'Enter' && autocompleteIndex >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectAutocompleteSuggestion(autocompleteIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeAutocomplete();
      }
    };
    const onAutocompleteInput = () => scheduleAutocomplete();
    const onAutocompleteBlur = () => window.setTimeout(closeAutocomplete, 150);
    searchInput.addEventListener('keydown', onAutocompleteKeyDown, true);
    searchInput.addEventListener('input', onAutocompleteInput);
    searchInput.addEventListener('blur', onAutocompleteBlur);
    searchInput.__taxonAutocompleteCleanup = () => {
      searchInput.removeEventListener('keydown', onAutocompleteKeyDown, true);
      searchInput.removeEventListener('input', onAutocompleteInput);
      searchInput.removeEventListener('blur', onAutocompleteBlur);
      closeAutocomplete();
      if (autocompleteList) autocompleteList.remove();
    };

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
        if (currentMatches.length > 1) {
          selectNodeWithinMatches(selectedNode);
        } else {
          focusNode(selectedNode);
        }
      } else if (e.key === 'ArrowUp' && currentMatches.length > 0) {
        e.preventDefault();
        currentMatchIndex = currentMatchIndex < 0 ? currentMatches.length - 1 : Math.max(currentMatchIndex - 1, 0);
        const selectedNode = currentMatches[currentMatchIndex];
        if (currentMatches.length > 1) {
          selectNodeWithinMatches(selectedNode);
        } else {
          focusNode(selectedNode);
        }
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
