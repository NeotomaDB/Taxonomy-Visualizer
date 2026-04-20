/**
 * groupUncertainLeaves
 *
 * After pathsToTree() builds the hierarchy object, this post-processing pass
 * scans every internal node for leaf children whose names start with
 * "Undetermined" or "Unknown".  When at least 2 such siblings are found they
 * are pulled out of the parent and placed under a new synthetic node:
 *
 *   "Undetermined (N)"  or  "Unknown (N)"
 *
 * The synthetic node is inserted at the same level as the original siblings so
 * the rest of the tree shape is preserved.  It is marked `isSyntheticGroup:true`
 * so rendering can style it like a collapsible group node.
 *
 * Synthetic node IDs use very large negative integers to avoid any collision
 * with real Neotoma IDs.
 *
 * @param {Object} treeRoot  - mutable tree root returned by pathsToTree()
 * @param {Map}    byId      - the byId map returned by pathsToTree() (updated in-place)
 * @param {Object} [options]
 * @param {number} [options.minGroupSize=2]  - min siblings required before grouping
 * @param {Set}    [options.taxagroups]  - if provided, only group these taxagroupids
 *                                          (undefined = always group)
 */
export function groupUncertainLeaves(treeRoot, byId, options = {}) {
  const { minGroupSize = 2 } = options;

  let syntheticIdCounter = -9_000_000; // distinct from orphan IDs (-1 000 000 range)

  /**
   * Returns 'undetermined' | 'unknown' | null for a node name.
   */
  function uncertainCategory(name) {
    if (!name) return null;
    const lower = name.trim().toLowerCase();
    if (lower.startsWith('undetermined')) return 'undetermined';
    if (lower.startsWith('unknown'))      return 'unknown';
    return null;
  }

  /**
   * Recursively walk the tree and group at each internal node.
   */
  function walk(node) {
    if (!node.children || node.children.length === 0) return;

    // Recurse into children first (bottom-up) so deeply nested groups are
    // collapsed before we inspect this level.
    node.children.forEach(walk);

    // Separate leaf-children by uncertain category vs. the rest.
    const buckets = { undetermined: [], unknown: [] };
    const keep = [];

    node.children.forEach(child => {
      // Only group true leaves (no children of their own).
      if (!child.children || child.children.length === 0) {
        const cat = uncertainCategory(child.name);
        if (cat) {
          buckets[cat].push(child);
          return;
        }
      }
      keep.push(child);
    });

    // Process each category independently.
    ['undetermined', 'unknown'].forEach(cat => {
      const members = buckets[cat];
      if (members.length < minGroupSize) {
        // Too few to bother grouping — put them back.
        keep.push(...members);
        return;
      }

      // Build label: capitalise the category word.
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      const synId = syntheticIdCounter--;

      const synNode = {
        id: synId,
        name: `${label} (${members.length})`,
        isSyntheticGroup: true,
        syntheticCategory: cat,   // 'undetermined' | 'unknown'
        leafCount: members.length,
        children: members,        // real children under synthetic parent
      };

      // Register in byId so synonym / search lookups don't explode.
      byId.set(synId, synNode);

      keep.push(synNode);
    });

    // Sort: synthetic groups always last so they don't push real taxa aside.
    keep.sort((a, b) => {
      const aS = a.isSyntheticGroup ? 1 : 0;
      const bS = b.isSyntheticGroup ? 1 : 0;
      return aS - bS;
    });

    node.children = keep;
  }

  walk(treeRoot);
}
