import { applyAngleCulling } from './src/labelCulling.js';
import { setupFocusInfo } from './src/searchFocus.js';
import { normalizeRows, pathsToTree, attachSynonymMetadata } from './src/data.js';
import { createPopup } from './src/popup.js';
import { highlightPath } from './src/highlight.js';
import { enrichTreeWithPaths, reorderTreeForGrouping, computeLeafOrder } from './src/grouping.js';
import { setupSearch } from './src/search.js';
import { initSynonyms, getSynonymInfo, isSynonymsReady } from './src/synonyms.js';
import { setHighlightedPath, clearHighlightedPath } from './src/viewSwitch.js';
import { setupHover } from './src/hover.js';
// Data helpers now imported from ./src/data.js

/**
 * Render a radial dendrogram from Neotoma mammal paths.
 * Usage:
 *   renderMammalTree({
 *     rows,                         // your path-list rows
 *     selector: '#chart',           // container CSS selector
 *     rootId: 6171,                 // Mammalia
 *     rootName: 'Mammalia',
 *     size: 900,                    // svg width/height
 *     margin: 40                    // extra padding
 *   });
 */
async function renderMammalTree({
  rows,
  allRowsForSynonyms = null,  // Optional: all rows including those filtered out, for adding synonym nodes
  selector = '#chart',
  rootId = 6171,
  rootName = 'Mammalia',
  size = 900,
  margin = 40,
  groupDepth = 1,  // Depth for grouping (0=root, 3=typically family level)
  groupPadding = 0.1,  // Extra angle (in radians) between groups (~5.7 degrees)
  siblingSeparation = 0.3,  // Minimum angle between siblings (in radians)
  isInitialView = false,  // Whether this is the initial 4-level view
  rootNodes = null,  // For initial view, the root nodes structure
  overviewDepth = null, // Collapse nodes deeper than this visible depth
  hideSingletonRootChildren = false, // Hide top-level singleton leaves in overview mode
  anchorIds = new Set(), // Set of anchor IDs to highlight in green
} = {}) {
  if (!rows || !rows.length) {
    console.warn('renderMammalTree: rows is empty.');
    return;
  }

  // Initialize synonym data for search functionality
  await initSynonyms();

  // 1) Build hierarchy from path-list
  const normalizedRows = normalizeRows(rows);

  // For initial view with rootNodes, build tree from rootNodes structure
  let treeData, byId;
  if (isInitialView && rootNodes) {
    // Build tree from rootNodes structure
    const root = { id: rootId, name: rootName, children: [] };
    byId = new Map([[root.id, root]]);

    function addNodeToTree(parent, nodeData) {
      let child = byId.get(nodeData.id);
      if (!child) {
        child = {
          id: nodeData.id,
          name: nodeData.name,
          taxagroupid: nodeData.taxagroupid,
          isAnchor: nodeData.isAnchor || (anchorIds && (anchorIds.has(nodeData.id) || anchorIds.has(parseInt(nodeData.id)))),
          children: []
        };
        byId.set(nodeData.id, child);
        if (!parent.children) parent.children = [];
        parent.children.push(child);
      }

      if (nodeData.children && nodeData.children.length > 0) {
        nodeData.children.forEach(childData => {
          addNodeToTree(child, childData);
        });
      }
    }

    rootNodes.forEach(rootNode => {
      addNodeToTree(root, rootNode);
    });

    // Prune empty children
    (function prune(n) {
      if (n.children && n.children.length) {
        n.children.forEach(prune);
      } else {
        delete n.children;
      }
    })(root);

    treeData = root;
  } else {
    const result = pathsToTree(normalizedRows, rootId, rootName, anchorIds);
    treeData = result.root;
    byId = result.byId;
  }

  // 1.5) Attach synonym metadata onto canonical nodes (no invalid nodes added to tree)
  const synonymManager = {
    isReady: () => isSynonymsReady(),
    getSynonymInfo: (id) => getSynonymInfo(id)
  };
  const rowsForSynonymLookup = allRowsForSynonyms || rows;
  const invalidIdToCanonicalId = attachSynonymMetadata(treeData, byId, synonymManager, rowsForSynonymLookup);
  // Expose the reverse lookup globally so search.js can resolve synonym queries
  window.__invalidIdToCanonicalId = invalidIdToCanonicalId;

  // Enrich tree with path information for grouping
  enrichTreeWithPaths(treeData, normalizedRows);

  const root = d3.hierarchy(treeData);

  function applyOverviewCollapse(rootNode, visibleDepth, hideSingletonRoots) {
    if (hideSingletonRoots && rootNode.children && rootNode.children.length > 0) {
      const visibleChildren = [];
      const hiddenChildren = [];
      rootNode.children.forEach(child => {
        if ((child.children && child.children.length > 0) || (child.data && child.data.leafCount > 1)) {
          visibleChildren.push(child);
        } else {
          hiddenChildren.push(child);
        }
      });
      rootNode.children = visibleChildren.length > 0 ? visibleChildren : null;
      rootNode._children = hiddenChildren.length > 0 ? hiddenChildren : null;
    }

    rootNode.each(d => {
      if (d.depth >= visibleDepth && d.children && d.children.length > 0) {
        d._children = d.children;
        d.children = null;
      }
    });
  }

  if (overviewDepth != null) {
    applyOverviewCollapse(root, overviewDepth, hideSingletonRootChildren);
  }

  function expandHiddenChildren(node) {
    if (!node || !node._children || node._children.length === 0) return false;
    node.children = node.children ? [...node.children, ...node._children] : node._children;
    node._children = null;
    return true;
  }

  // 1.5) Reorder tree to group leaves by family
  reorderTreeForGrouping(root, groupDepth);

  // Compute leaf order and store groupKey on each node
  const { leafToIndex, leafGroups } = computeLeafOrder(root, groupDepth);

  // Store groupKey on each leaf node for easy access
  leafGroups.forEach((item) => {
    item.leaf._groupKey = item.groupKey;
  });

  // For internal nodes, compute a representative groupKey from their leaves
  // If a node contains leaves from multiple groups, mark it as mixed
  root.each(d => {
    if (d.children && d.children.length > 0) {
      const leaves = d.leaves();
      if (leaves.length > 0) {
        const groups = new Set(leaves.map(l => l._groupKey).filter(Boolean));
        if (groups.size === 1) {
          // All leaves belong to the same group
          d._groupKey = Array.from(groups)[0];
        } else if (groups.size > 1) {
          // Mixed groups - use null to indicate this
          d._groupKey = null;
        }
      }
    }
  });

  // 2) Layout with custom separation
  const radius = (size / 2) - 2.5 * margin;

  // Custom separation function: smaller angle within groups, larger between groups
  // Note: d3.cluster.separation receives two adjacent sibling nodes
  function customSeparation(a, b) {
    // If either node is the root, use default separation
    if (!a.parent || !b.parent || a.parent !== b.parent) return 1;

    const groupA = a._groupKey;
    const groupB = b._groupKey;

    // If either node is mixed (null), use default separation
    if (!groupA || !groupB) return 1;

    if (groupA === groupB) {
      // Same group: use smaller separation
      return siblingSeparation;
    } else {
      // Different groups: add significant padding to create visual gap
      return 1 + groupPadding;
    }
  }

  d3.cluster()
    .size([2 * Math.PI, radius])
    .separation(customSeparation)(root);

  // 2.5) Default-view decluttering rule for "Chemical Substance" and "Mammalia"
  // This collapses leaf-level descendants under the subtrees by default,
  // and provides + / – toggles for interactive exploration.
  if (isInitialView) {
    collapseChemicalSubstanceLeavesByDefault(root);
  }

  // Tiered summary view for large groups: show anchor + one level of children,
  // collapse everything deeper so the initial view is readable.
  const taxagroupid = rows[0]?.taxagroupid;
  const ONE_LEVEL_GROUPS = new Set(['MAM', 'AVE', 'DIA']);

  // Small / manageable groups: force-expand all nodes so nothing is hidden.
  const EXPAND_ALL_GROUPS = new Set([
    'SPO', 'CNI', 'BRC', 'ANL', 'MOL', 'NEM', 'FLT', 'ECH', 'ROT', 'BRZ', 'FUN',
  ]);

  if (ONE_LEVEL_GROUPS.has(taxagroupid) && !isInitialView) {
    // Anchor node is root. Its direct children (Orders / Classes) stay visible;
    // everything below them is collapsed into _children for +/– expansion.
    root.children?.forEach(child => {
      if (child.children && child.children.length > 0) {
        child._children = child.children;
        child.children = null;
      }
    });
  } else if (EXPAND_ALL_GROUPS.has(taxagroupid) && !isInitialView) {
    // Ensure no node is accidentally collapsed on first render.
    root.descendants().forEach(d => {
      if (d._children) { d.children = d._children; d._children = null; }
    });
  }

  // 3) SVG scaffold
  const svg = d3.select(selector).append('svg')
    .attr('viewBox', [-size / 2, -size / 2, size, size])
    .attr('width', size)
    .attr('height', size);

  // Wrap content in two groups: viewport (pan+zoom) -> rotator (rotate)
  const gViewport = svg.append('g').attr('class', 'viewport').attr('transform', 'translate(0,0) scale(1)');
  const gRoot = gViewport.append('g').attr('class', 'rotator').attr('transform', 'rotate(0)');
  const gLinks = gRoot.append('g').attr('class', 'links').attr('fill', 'none').attr('stroke', '#9aa0a6').attr('stroke-opacity', 0.8);
  const gNodes = gRoot.append('g').attr('class', 'nodes');

  // Root center label — fixed at origin, does not rotate
  const gRootLabel = gViewport.append('g').attr('class', 'root-center-label');
  gRootLabel.append('circle')
    .attr('r', 20)
    .attr('fill', '#e8f5e9')
    .attr('stroke', '#43a047')
    .attr('stroke-width', 1.5);
  gRootLabel.append('text')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .style('font-size', '11px')
    .style('font-weight', '700')
    .style('fill', '#2e7d32')
    .style('pointer-events', 'none')
    .text(rootName);

  // Track transform state for rotate + zoom
  let currentRotate = 0;
  let currentScale = 1;
  let currentTranslateX = 0;
  let currentTranslateY = 0;
  const zoomValueEl = document.getElementById('zoomValue');
  function updateViewport() {
    gViewport.attr('transform', `translate(${currentTranslateX},${currentTranslateY}) scale(${currentScale})`);
    if (zoomValueEl) zoomValueEl.textContent = `${currentScale.toFixed(1)}\u00D7`;
  }
  function updateRotate() {
    gRoot.attr('transform', `rotate(${currentRotate})`);
  }

  // 4) Links
  const linkGen = d3.linkRadial()
    .angle(d => d.x)
    .radius(d => d.y);

  let link = gLinks.selectAll('path');

  // Click on a link: treat as focusing its target node
  let linkClickTimer = null;
  link.style('cursor', 'pointer')
    .on('click', (event, d) => {
      clearTimeout(linkClickTimer);
      linkClickTimer = setTimeout(() => {
        const t = d.target;
        highlightPath(link, node, t);
        setHighlightedPath(t);
        if (typeof info !== 'undefined' && info) info.show(t);
      }, 220);
    });

  // 5) Nodes
  let node = gNodes.selectAll('g.node');

  // Helper: determine if node is under "Chemical Substance", "Chemical compound", "Fungi", "Algae", "Plantae undiff.", "Prokaryota", "Chromista", "Cnidaria", "Annelida", "Plantae", "Bryozoa", "Arthropoda", "Rhizophagidae", "Cybocephalidae", "Invertebrata", or "Ostomidae" subtree
  function isUnderChemical(d) {
    return d.ancestors().some(a => {
      const n = (a.data && a.data.name) ? String(a.data.name).trim().toLowerCase() : '';
      return n === 'chemical substance' || n === 'chemical compound' || n === 'fungi' || n === 'algae' || n === 'plantae undiff.' || n === 'prokaryota' || n === 'chromista' || n === 'cnidaria' || n === 'annelida' || n === 'plantae' || n === 'bryozoa' || n === 'arthropoda' || n === 'mammalia' || n === 'vertebrata' || n === 'unknown' || n === 'rhizophagidae' || n === 'cybocephalidae' || n === 'invertebrata' || n === 'ostomidae';
    });
  }

  // Update-draw function to support expand/collapse with smooth layout
  // triggerNode: if provided, keeps this node at its current angular position after re-layout
  function update(duration = 250, triggerNode = null) {
    // Store the trigger node's angular position before re-layout
    const oldTriggerX = triggerNode ? triggerNode.x : null;

    // Recompute layout (cluster ignores hidden _children)
    d3.cluster().size([2 * Math.PI, radius]).separation(customSeparation)(root);

    // Apply corrective rotation so the trigger node stays visually stable
    if (triggerNode && oldTriggerX !== null) {
      const newTriggerX = triggerNode.x;
      const angleDriftDeg = (newTriggerX - oldTriggerX) * 180 / Math.PI;
      currentRotate -= angleDriftDeg;
      updateRotate();
      // Sync rotation slider and display value
      const ri = document.getElementById('rotate');
      const rv = document.getElementById('rotateValue');
      if (ri) ri.value = Math.round(currentRotate);
      if (rv) rv.textContent = `${Math.round(currentRotate)}\u00B0`;
    }

    const t = svg.transition().duration(duration);

    // Update links
    const linksData = root.links();
    link = gLinks.selectAll('path')
      .data(linksData, d => `${d.source.data.id}-${d.target.data.id}`);

    link.join(
      enter => enter.append('path').attr('d', linkGen),
      updateSel => updateSel,
      exit => exit.transition(t).style('opacity', 0).remove()
    ).transition(t).attr('d', linkGen).style('opacity', 1);

    // Update nodes
    const nodesData = root.descendants();
    node = gNodes.selectAll('g.node')
      .data(nodesData, d => d.data.id);

    const nodeEnter = node.enter()
      .append('g')
      .attr('class', 'node')
      .attr('transform', d => `rotate(${(d.x * 180 / Math.PI - 90)}) translate(${d.y},0)`)
      .style('opacity', 0);

    // Invisible hit area for easier clicking (Fitts's Law)
    nodeEnter.append('circle')
      .attr('class', 'hit-area')
      .attr('r', 10)
      .attr('fill', 'transparent')
      .attr('stroke', 'none')
      .style('pointer-events', 'all');

    nodeEnter.append('circle')
      .attr('r', 3.5)
      .style('pointer-events', 'none')
      .attr('fill', d => {
        if (d.data && d.data.isAnchor) return '#2e7d32'; // Anchor green

        const nodeName = (d.data && d.data.name) ? String(d.data.name).trim().toLowerCase() : '';
        const isCollapsedGroup = nodeName === 'chemical substance' || nodeName === 'chemical compound' ||
          nodeName === 'fungi' || nodeName === 'algae' || nodeName === 'plantae undiff.' ||
          nodeName === 'prokaryota' || nodeName === 'chromista' || nodeName === 'cnidaria' ||
          nodeName === 'annelida' || nodeName === 'plantae' || nodeName === 'bryozoa' || nodeName === 'arthropoda' ||
          nodeName === 'mammalia' || nodeName === 'vertebrata' || nodeName === 'unknown' ||
          nodeName === 'rhizophagidae' || nodeName === 'cybocephalidae' || nodeName === 'ostomidae';
        return isCollapsedGroup ? '#6b7280' : '#202124';
      });

    nodeEnter.append('text')
      .attr('dy', '0.32em')
      .attr('x', 10) // Will be updated by updateLabelOrientation()
      .attr('text-anchor', 'start') // Will be updated by updateLabelOrientation()
      .style('fill', d => {
        if (d.data && d.data.isAnchor) return '#2e7d32'; // Anchor green

        // Check if this node is one of the collapsed groups
        const nodeName = (d.data && d.data.name) ? String(d.data.name).trim().toLowerCase() : '';
        const isCollapsedGroup = nodeName === 'chemical substance' || nodeName === 'chemical compound' ||
          nodeName === 'fungi' || nodeName === 'algae' || nodeName === 'plantae undiff.' ||
          nodeName === 'prokaryota' || nodeName === 'chromista' || nodeName === 'cnidaria' ||
          nodeName === 'annelida' || nodeName === 'plantae' || nodeName === 'bryozoa' || nodeName === 'arthropoda' ||
          nodeName === 'mammalia' || nodeName === 'vertebrata' || nodeName === 'unknown' ||
          nodeName === 'rhizophagidae' || nodeName === 'cybocephalidae' || nodeName === 'ostomidae';
        return isCollapsedGroup ? '#6b7280' : null;
      })
      .text(d => {
        let name = d.data.name;
        // Append count if node is collapsed and has a leafCount
        if (d._children && d._children.length > 0 && d.data.leafCount) {
          name += ` (${d.data.leafCount})`;
        }
        return name;
      });

    // Toggle control (+ / –) button with background circle for visibility
    const toggleGroup = nodeEnter.append('g')
      .attr('class', 'toggle-group')
      .attr('transform', 'translate(0, -14)')
      .style('cursor', 'pointer')
      .style('display', d => {
        if (d._children && d._children.length) return 'block';
        if (d.children && d.children.length) return 'block';
        return 'none';
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        if (d._children && d._children.length) {
          // expand
          expandHiddenChildren(d);
        } else if (d.children && d.children.length) {
          // collapse
          d._children = d.children;
          d.children = null;
        }
        update(300, d);
        // After update, refresh interactions bound to node/link
        bindNodeInteractions();
        updateLabelOrientation();
        // Re-run label culling after transition so newly visible labels are
        // correctly shown/hidden (fixes text overcrowding on re-expand).
        if (cull) setTimeout(() => cull.refresh(), 320);
      });

    toggleGroup.append('circle')
      .attr('r', 9)
      .attr('fill', '#f3f4f6')
      .attr('stroke', '#6b7280')
      .attr('stroke-width', 1.5);

    toggleGroup.append('text')
      .attr('class', 'toggle')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .style('font-weight', '700')
      .style('font-size', '14px')
      .style('fill', '#6b7280')
      .style('pointer-events', 'none')
      .text(d => {
        if (d._children && d._children.length) return '+';
        if (d.children && d.children.length) return '\u2013';
        return '';
      });

    const nodeMerge = nodeEnter.merge(node);

    nodeMerge.transition(t)
      .attr('transform', d => `rotate(${(d.x * 180 / Math.PI - 90)}) translate(${d.y},0)`)
      .style('opacity', 1);

    // Update toggle symbols and visibility per current expand/collapse state
    nodeMerge.select('.toggle-group')
      .style('display', d => {
        if (d._children && d._children.length) return 'block';
        if (d.children && d.children.length) return 'block';
        return 'none';
      });
    nodeMerge.select('text.toggle')
      .text(d => {
        if (d._children && d._children.length) return '+';
        if (d.children && d.children.length) return '\u2013';
        return '';
      });

    // Remove exits
    node.exit().transition(t).style('opacity', 0).remove();
  }

  // Recompute text orientation after rotation so labels don't appear upside-down
  function updateLabelOrientation() {
    const rotRad = (currentRotate * Math.PI) / 180;
    const tau = Math.PI * 2;
    function outward(d) { return ((d.x + rotRad) % tau + tau) % tau < Math.PI; }
    // Re-query live DOM so newly entered nodes (after expand) are included.
    gNodes.selectAll('g.node').select('text:not(.toggle)')
      .attr('x', d => outward(d) ? 10 : -10)
      .attr('text-anchor', d => outward(d) ? 'start' : 'end')
      .attr('transform', d => outward(d) ? null : 'rotate(180)');
  }

  // Initialize label orientation correctly
  // Bind interactions that rely on node/link selections
  function bindNodeInteractions() {
    // Click on a link: treat as focusing its target node
    let linkClickTimer = null;
    gLinks.selectAll('path')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        clearTimeout(linkClickTimer);
        linkClickTimer = setTimeout(() => {
          // Clear all previous highlights using direct DOM manipulation
          document.querySelectorAll('.highlight').forEach(el => {
            el.classList.remove('highlight');
          });

          // Then apply new highlights
          const tNode = d.target;
          highlightPath(gLinks.selectAll('path'), gNodes.selectAll('g.node'), tNode);
          setHighlightedPath(tNode);
          if (typeof info !== 'undefined' && info) info.show(tNode);
        }, 220);
      });

    // Node click/dblclick
    let clickTimer = null;
    gNodes.selectAll('g.node')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          // Clear all previous highlights using direct DOM manipulation
          document.querySelectorAll('.highlight').forEach(el => {
            el.classList.remove('highlight');
          });

          // Then apply new highlights
          highlightPath(gLinks.selectAll('path'), gNodes.selectAll('g.node'), d);
          setHighlightedPath(d);
          if (info) info.show(d);
        }, 220);
      })
      .on('dblclick', (event, d) => {
        clearTimeout(clickTimer);
        if (d.children && d.children.length > 0 && window.navigateToNode) {
          const nodeData = d.data;
          const taxagroupid = nodeData.taxagroupid || 'MAM';
          window.navigateToNode(nodeData.id, nodeData.name, taxagroupid);
          return;
        }
        const names = d.ancestors().reverse().map(a => a.data.name).join(' / ');
        showPopupAt(event.pageX, event.pageY, d.data.name, '');
      });

    // Click on empty space (SVG background) to reset search state/highlights
    svg.on('click', (event) => {
      // Only clear if clicking directly on the SVG (not on nodes or links)
      if (event.target === event.currentTarget || event.target.tagName === 'svg') {
        if (searchControls && typeof searchControls.resetSearchState === 'function') {
          searchControls.resetSearchState();
        } else {
          document.querySelectorAll('.highlight').forEach(el => {
            el.classList.remove('highlight');
          });
          if (info) info.clear();
        }
      }
    });

    setupHover(gNodes.selectAll('g.node'));
  }

  // Initial draw
  update(0);
  updateLabelOrientation();
  bindNodeInteractions();

  // Angle-based label culling (avoid overlap at initial scale)
  // Pass a getter so recompute() always queries the live DOM after expand/collapse.
  const cull = applyAngleCulling(root, () => gNodes.selectAll('g.node'), 1.1);
  const info = setupFocusInfo(gNodes.selectAll('g.node'), () => currentRotate);
  const { showAt: showPopupAt } = createPopup('popup');

  // Rebind interactions after initial info is created
  bindNodeInteractions();

  // 7) Rotation UI hookup (optional)
  const rotateInput = document.getElementById('rotate');
  const rotateValueEl = document.getElementById('rotateValue');
  function applyRotation(deg) {
    currentRotate = deg;
    updateRotate();
    updateLabelOrientation();
    if (rotateValueEl) rotateValueEl.textContent = `${deg}\u00B0`;
  }
  if (rotateInput) {
    applyRotation(Number(rotateInput.value || 0));
    rotateInput.addEventListener('input', (e) => applyRotation(Number(e.target.value)));
  }

  // Function to ensure a node's full path is visible (expanded)
  function expandToNode(d) {
    let current = d;
    let anyExpanded = false;
    while (current.parent) {
      if (expandHiddenChildren(current.parent)) {
        anyExpanded = true;
      }
      current = current.parent;
    }
    if (anyExpanded) {
      update();
    }
  }

  // 7.5) Search + focus
  const searchControls = setupSearch({
    root,
    link: gLinks.selectAll('path'),       // kept for fallback
    node: gNodes.selectAll('g.node'),     // kept for fallback
    svg,                                  // SVG D3 selection for search-active class
    getLiveLinks: () => gLinks.selectAll('path'),
    getLiveNodes: () => gNodes.selectAll('g.node'),
    info,
    setCurrentRotate: (value) => { currentRotate = value; },
    updateRotate,
    updateLabelOrientation,
    expandToNode,
    searchPathOnly: taxagroupid === 'INS',
    deferLocalResultsRendering: taxagroupid === 'INS',
    onSearchResults: taxagroupid === 'INS' && typeof window !== 'undefined' && window.activateFocusView
      ? () => window.activateFocusView()
      : null,
    onSearchClear: () => { if (cull) cull.refresh(); },
  });

  // 8) Zoom/pan (wheel/pinch)
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.3, 8])
    .on('zoom', (event) => {
      currentScale = event.transform.k;
      currentTranslateX = event.transform.x;
      currentTranslateY = event.transform.y;
      updateViewport();
      if (cull && cull.updateByScale) cull.updateByScale(event.transform.k);
    });
  svg.call(zoomBehavior).on('dblclick.zoom', null);

  // Buttons for zoom control
  const btnIn = document.getElementById('zoomIn');
  const btnOut = document.getElementById('zoomOut');
  const btnReset = document.getElementById('zoomReset');
  if (btnIn) btnIn.addEventListener('click', () => svg.transition().duration(150).call(zoomBehavior.scaleBy, 1.2));
  if (btnOut) btnOut.addEventListener('click', () => svg.transition().duration(150).call(zoomBehavior.scaleBy, 1 / 1.2));
  if (btnReset) btnReset.addEventListener('click', () => svg.transition().duration(150).call(zoomBehavior.transform, d3.zoomIdentity));

  // Initialize transforms
  updateViewport();
  updateRotate();
}

/**
   collapseChemicalSubstanceLeavesByDefault
 * Default-view decluttering rule: In initial view, find the node named "Chemical Substance", "Chemical compound", "Fungi", "Algae", "Plantae undiff.", "Prokaryota", "Chromista", "Cnidaria", "Annelida", "Rhizophagidae", "Cybocephalidae", "Invertebrata", or "Ostomidae"
 * and collapse all of its leaf-level descendants so only higher-level structure shows.
   Collapsed children are stored on _children to allow restoring via + / – toggles.
 */
function collapseChemicalSubstanceLeavesByDefault(root) {
  // Find "Chemical Substance", "Chemical compound", "Fungi", "Algae", "Plantae undiff.", "Prokaryota", "Chromista", "Cnidaria", "Annelida", "Rhizophagidae", "Cybocephalidae", "Invertebrata", or "Ostomidae" node in the current hierarchy
  const chems = root.descendants().filter(d => {
    const n = (d.data && d.data.name) ? String(d.data.name).trim().toLowerCase() : '';
    return n === 'chemical substance' || n === 'chemical compound' || n === 'fungi' || n === 'algae' || n === 'plantae undiff.' || n === 'prokaryota' || n === 'chromista' || n === 'cnidaria' || n === 'annelida' || n === 'plantae' || n === 'bryozoa' || n === 'arthropoda' || n === 'rhizophagidae' || n === 'cybocephalidae' || n === 'invertebrata' || n === 'ostomidae' || n === 'unknown';
  });

  if (!chems.length) return;

  // Collapse the node itself
  chems.forEach(chem => {
    if (chem.children && chem.children.length > 0) {
      chem._children = chem.children;
      chem.children = null;
    }
  });
}

// Optional CSS to include in your page/app:
// .highlight { stroke: #e24a33 !important; stroke-width: 2.5px; fill: #e24a33; font-weight: 600; }

// Expose for index.html which calls renderMammalTree from a non-module script
// while still allowing ES module imports above.
// If running in a browser, attach to window for convenience.
if (typeof window !== 'undefined') {
  window.renderMammalTree = renderMammalTree;
  window.collapseChemicalSubstanceLeavesByDefault = collapseChemicalSubstanceLeavesByDefault;
}

export { renderMammalTree };
