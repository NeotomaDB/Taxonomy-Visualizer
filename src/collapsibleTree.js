import { setupFocusInfo } from './searchFocus.js';
import { setupSearch } from './search.js';
import { highlightPath } from './highlight.js';
import { setHighlightedPath } from './viewSwitch.js';

/**
 * Render a collapsible tree layout for small datasets (< 50 nodes)
 * Based on D3's collapsible tree example
 */
export async function renderCollapsibleTree({
    rows,
    allRowsForSynonyms = null,
    selector = '#chart',
    rootId,
    rootName,
    width = 900,
    height = 600,
} = {}) {
    if (!rows || !rows.length) {
        console.warn('renderCollapsibleTree: rows is empty.');
        return;
    }

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

    // Convert to d3 hierarchy
    const hierarchyRoot = d3.hierarchy(root);

    // Set up tree layout
    const dx = 25;
    const dy = width / (hierarchyRoot.height + 1);
    const tree = d3.tree().nodeSize([dx, dy]);

    // Initialize with all nodes collapsed except first level
    hierarchyRoot.descendants().forEach((d, i) => {
        d._children = d.children;
        if (d.depth > 1) {
            d.children = null;
        }
    });

    // Create SVG
    const svg = d3.select(selector).append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', [-dy / 3, -dx, width, dx * (hierarchyRoot.descendants().length + 1)])
        .style('font', '12px "DM Sans", sans-serif')
        .style('user-select', 'none');

    const gLink = svg.append('g')
        .attr('fill', 'none')
        .attr('stroke', '#9aa0a6')
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', 1.5);

    const gNode = svg.append('g')
        .attr('cursor', 'pointer')
        .attr('pointer-events', 'all');

    function update(source) {
        const duration = 250;
        const nodes = hierarchyRoot.descendants().reverse();
        const links = hierarchyRoot.links();

        // Compute the new tree layout
        tree(hierarchyRoot);

        let left = hierarchyRoot;
        let right = hierarchyRoot;
        hierarchyRoot.eachBefore(node => {
            if (node.x < left.x) left = node;
            if (node.x > right.x) right = node;
        });

        const height = right.x - left.x + dx * 2;

        const transition = svg.transition()
            .duration(duration)
            .attr('viewBox', [-dy / 3, left.x - dx, width, height])
            .tween('resize', window.ResizeObserver ? null : () => () => svg.dispatch('toggle'));

        // Update nodes
        const node = gNode.selectAll('g')
            .data(nodes, d => d.id || (d.id = ++i));

        const nodeEnter = node.enter().append('g')
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
            .attr('fill', d => d._children ? '#555' : '#999')
            .attr('stroke-width', 10);

        nodeEnter.append('text')
            .attr('dy', '0.31em')
            .attr('x', d => d._children ? -8 : 8)
            .attr('text-anchor', d => d._children ? 'end' : 'start')
            .text(d => d.data.name)
            .clone(true).lower()
            .attr('stroke-linejoin', 'round')
            .attr('stroke-width', 3)
            .attr('stroke', 'white');

        const nodeUpdate = node.merge(nodeEnter).transition(transition)
            .attr('transform', d => `translate(${d.y},${d.x})`)
            .attr('fill-opacity', 1)
            .attr('stroke-opacity', 1);

        const nodeExit = node.exit().transition(transition).remove()
            .attr('transform', d => `translate(${source.y},${source.x})`)
            .attr('fill-opacity', 0)
            .attr('stroke-opacity', 0);

        // Update links
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

        // Stash the old positions for transition
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

    // Setup search functionality
    setupSearch({
        root: hierarchyRoot,
        link: gLink.selectAll('path'),
        node: gNode.selectAll('g'),
        info: null,
        setCurrentRotate: () => { },
        updateRotate: () => { },
        updateLabelOrientation: () => { }
    });
}
