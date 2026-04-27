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

  // Highlight and raise the links in the path
  linkSel.filter(l => A.has(l.source) && A.has(l.target))
    .classed('highlight', true)
    .raise();

  // Highlight and raise the entire node group (circle, text, toggle) to ensure it renders on top of everything else
  nodeSel.filter(n => A.has(n))
    .raise()
    .selectAll('text')
    .classed('highlight', true);
}
