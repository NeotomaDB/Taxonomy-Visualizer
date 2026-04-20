import { setupFocusInfo } from './searchFocus.js';
import { setupSearch } from './search.js';
import { highlightPath } from './highlight.js';
import { setHighlightedPath } from './viewSwitch.js';
import { attachSynonymMetadata } from './data.js';
import { initSynonyms, getSynonymInfo, isSynonymsReady } from './synonyms.js';

/**
 * Render a collapsible tree layout.
 * Supports mouse/trackpad pan & zoom.
 * Root label is not clipped on the left.
 */
export async function renderCollapsibleTree({
    rows,
    allRowsForSynonyms = null,
    selector = '#chart',
    rootId,
    rootName,
    width = 900,
    height = 600,
    anchorIds = new Set(), // Set of anchor IDs to highlight in green
    expandAll = false,     // If true, show the full tree fully expanded at init
    initialQuery = '',
    autoRunSearch = false,
    taxagroupid = null,    // e.g. 'DIA' — used to show external links like AlgaeBase
} = {}) {
    if (!rows || !rows.length) {
        console.warn('renderCollapsibleTree: rows is empty.');
        return;
    }

    // Defensive clear so repeated Focus View renders cannot stack multiple
    // collapsible SVGs inside the same chart container.
    d3.select(selector).selectAll('*').remove();

    // Ensure synonym data is loaded before attaching metadata.
    await initSynonyms();

    // Build hierarchy from path-list
    const byId = new Map();
    const root = { id: rootId, name: rootName, children: [] };
    byId.set(rootId, root);

    rows.forEach(row => {
        const ids = row.ids_root_to_leaf || [];
        const names = row.names_root_to_leaf || [];

        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const name = names[i];

            if (!byId.has(id)) {
                byId.set(id, { id, name, children: [] });
            }

            if (i > 0) {
                const parentId = ids[i - 1];
                const parent = byId.get(parentId);
                const child = byId.get(id);

                if (parent && child && !parent.children.includes(child)) {
                    parent.children.push(child);
                }
            }
        }
    });

    // Sort children alphabetically at every level so siblings appear A→Z.
    // Applied before d3.hierarchy() so the layout reflects sorted order.
    (function sortTree(node) {
        if (node.children && node.children.length > 1) {
            node.children.sort((a, b) => a.name.localeCompare(b.name));
            node.children.forEach(sortTree);
        }
    })(root);

    // Attach synonym metadata onto canonical nodes so search & info panel can
    // resolve synonym queries (same as the radial tree does via mammal_path_combined.js).
    const synonymManager = {
        isReady: () => isSynonymsReady(),
        getSynonymInfo: (id) => getSynonymInfo(id),
    };
    const rowsForSynonymLookup = allRowsForSynonyms || rows;
    const invalidIdToCanonicalId = attachSynonymMetadata(
        root, byId, synonymManager, rowsForSynonymLookup
    );
    // Expose the reverse lookup globally so search.js can resolve synonym queries.
    window.__invalidIdToCanonicalId = invalidIdToCanonicalId;

    // Convert to d3 hierarchy
    const hierarchyRoot = d3.hierarchy(root);

    // Also sort on the d3 hierarchy object to guarantee alphabetical order
    // even if the pre-sort above was somehow skipped (e.g. module cache).
    hierarchyRoot.sort((a, b) => a.data.name.localeCompare(b.data.name));

    // Tree layout
    const dx = 25;
    const dy = width / (hierarchyRoot.height + 1);
    const tree = d3.tree().nodeSize([dx, dy]);

    // Default: collapse everything beyond depth 1 so the tree opens compactly.
    // When expandAll=true (small, manageable groups) keep every node open.
    hierarchyRoot.descendants().forEach((d) => {
        if (expandAll) {
            // Leave d.children intact; stash a copy in _children for toggle use
            d._children = d.children && d.children.length ? d.children : null;
        } else {
            d._children = d.children;
            if (d.depth > 1) {
                d.children = null;
            }
        }
    });

    // Left margin: enough space for the root label so it is never clipped.
    // ~7px per character is a rough estimate for 12px DM Sans.
    const leftMargin = Math.max(rootName.length * 7 + 24, dy * 0.6);

    // Create SVG — overflow:visible so labels outside the SVG box are shown
    const svg = d3.select(selector).append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('font', '12px "DM Sans", sans-serif')
        .style('user-select', 'none')
        .style('overflow', 'visible');    // <-- prevents label clipping

    // Also allow the #chart container to show overflow
    d3.select(selector).style('overflow', 'visible');

    // Inner <g> that zoom/pan transforms are applied to
    const gMain = svg.append('g');

    const gLink = gMain.append('g')
        .attr('fill', 'none')
        .attr('stroke', '#9aa0a6')
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', 1.5);

    const gNode = gMain.append('g')
        .attr('cursor', 'pointer')
        .attr('pointer-events', 'all');

    // Zoom behaviour — transforms gMain
    const zoom = d3.zoom()
        .scaleExtent([0.1, 8])
        .on('zoom', (event) => {
            gMain.attr('transform', event.transform);
        });

    svg.call(zoom).on('dblclick.zoom', null);

    // Track whether the initial centering has been applied
    let initialised = false;

    function update(source) {
        const duration = 250;
        const nodes = hierarchyRoot.descendants().reverse();
        const links = hierarchyRoot.links();

        // Compute new tree layout
        tree(hierarchyRoot);

        // Find vertical extent
        let topNode = hierarchyRoot;
        let bottomNode = hierarchyRoot;
        hierarchyRoot.eachBefore(node => {
            if (node.x < topNode.x) topNode = node;
            if (node.x > bottomNode.x) bottomNode = node;
        });

        // Only centre the view on the very first render
        if (!initialised) {
            const centerY = height / 2 - (topNode.x + bottomNode.x) / 2;
            svg.call(zoom.transform, d3.zoomIdentity.translate(leftMargin, centerY));
            initialised = true;
        }

        const transition = svg.transition().duration(duration);

        // --- nodes ---
        const node = gNode.selectAll('g')
            .data(nodes, d => d.id || (d.id = ++i));

        const nodeEnter = node.enter().append('g')
            .attr('class', 'node')
            .attr('transform', d => `translate(${source.y0 || 0},${source.x0 || 0})`)
            .attr('fill-opacity', 0)
            .attr('stroke-opacity', 0)
            .on('click', (event, d) => {
                if (d.children || d._children) {
                    d.children = d.children ? null : d._children;
                    update(d);
                }
            });

        nodeEnter.append('circle')
            .attr('r', 4.5)
            .attr('fill', d => {
                if (d.data && d.data.isAnchor) return '#2e7d32'; // Anchor green
                return d._children ? '#555' : '#999';
            })
            .attr('stroke-width', 10);

        nodeEnter.append('text')
            .attr('class', 'node-label')
            .attr('dy', '0.31em')
            .attr('x', d => d._children ? -8 : 8)
            .attr('text-anchor', d => d._children ? 'end' : 'start')
            .text(d => d.data.name)
            .clone(true).lower()
            .attr('class', 'node-label label-halo')
            .attr('stroke-linejoin', 'round')
            .attr('stroke-width', 3)
            .attr('stroke', 'white');

        node.merge(nodeEnter).transition(transition)
            .attr('transform', d => `translate(${d.y},${d.x})`)
            .attr('fill-opacity', 1)
            .attr('stroke-opacity', 1);

        node.exit().transition(transition).remove()
            .attr('transform', d => `translate(${source.y},${source.x})`)
            .attr('fill-opacity', 0)
            .attr('stroke-opacity', 0);

        // --- links ---
        const link = gLink.selectAll('path')
            .data(links, d => d.target.id);

        const linkEnter = link.enter().append('path')
            .attr('d', d => {
                const o = { x: source.x0 || 0, y: source.y0 || 0 };
                return diagonal({ source: o, target: o });
            });

        link.merge(linkEnter).transition(transition)
            .attr('d', diagonal);

        link.exit().transition(transition).remove()
            .attr('d', d => {
                const o = { x: source.x, y: source.y };
                return diagonal({ source: o, target: o });
            });

        // Stash positions
        hierarchyRoot.eachBefore(d => {
            d.x0 = d.x;
            d.y0 = d.y;
        });
    }

    function diagonal(d) {
        return `M${d.source.y},${d.source.x}
            C${(d.source.y + d.target.y) / 2},${d.source.x}
             ${(d.source.y + d.target.y) / 2},${d.target.x}
             ${d.target.y},${d.target.x}`;
    }

    let i = 0;
    update(hierarchyRoot);

    // Wire up the info panel so clicking a node shows its taxonomy path +
    // synonym info (same behaviour as the radial tree view).
    const info = setupFocusInfo(gNode.selectAll('g.node'), () => 0);

    // Setup search functionality
    setupSearch({
        root: hierarchyRoot,
        link: gLink.selectAll('path'),
        node: gNode.selectAll('g.node'),
        svg,
        getLiveLinks: () => gLink.selectAll('path'),
        getLiveNodes: () => gNode.selectAll('g.node'),
        info,
        setCurrentRotate: () => { },
        updateRotate: () => { },
        updateLabelOrientation: () => { },
        initialQuery,
        autoRunSearch,
        keepResultsListOnSelect: false,  // click a result → show details + synonym + Back button
        disableGoToTree: true,           // we're already in a tree; navigateToNode is irrelevant here
        taxagroupid: taxagroupid || rows?.[0]?.taxagroupid || null,
        onSearchClear: () => { },
    });
}

