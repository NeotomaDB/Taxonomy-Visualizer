// Highlight utilities for path and nodes
export function highlightPath(linkSel, nodeSel, focusNode) {
  // First, clear ALL previous highlights by removing the class from all elements
  linkSel.each(function () {
    d3.select(this).classed('highlight', false);
  });
  nodeSel.selectAll('text').each(function () {
    d3.select(this).classed('highlight', false);
  });

  // Then apply new highlights
  const A = new Set(focusNode.ancestors());
  linkSel.classed('highlight', l => A.has(l.source) && A.has(l.target));
  nodeSel.selectAll('text').classed('highlight', n => A.has(n));
}
