/**
 * Return only recorded taxonomic nodes from a d3 hierarchy path.
 *
 * A forest renderer may use an invisible layout container so multiple real
 * roots can share one SVG. That container is not taxonomy and must never
 * appear in paths or shared-ancestor calculations.
 */
export function taxonomicAncestors(node, { rootToLeaf = false } = {}) {
  if (!node || typeof node.ancestors !== 'function') return [];

  const ancestors = node
    .ancestors()
    .filter((ancestor) => !ancestor?.data?.isVirtualForestRoot);

  return rootToLeaf ? ancestors.reverse() : ancestors;
}

