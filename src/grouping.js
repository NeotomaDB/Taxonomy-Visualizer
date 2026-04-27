// Grouping utilities: compute groupKey for leaves and sort them

/**
 * Infer family from a path (names array).
 * Looks for names ending in -idae, or uses a node at a specific depth.
 */
function inferFamilyFromPath(names, groupDepth = 3) {
  if (!names || !Array.isArray(names)) return null;
  
  // First, try to find a name ending in -idae (typical family suffix)
  for (let i = names.length - 1; i >= 0; i--) {
    if (names[i] && names[i].toLowerCase().endsWith('idae')) {
      return names[i];
    }
  }
  
  // Fallback: use node at groupDepth (0-indexed from root, so depth 3 = 4th level)
  // Adjust for root: if root is at index 0, then depth 3 means index 3
  if (names.length > groupDepth && names[groupDepth]) {
    return names[groupDepth];
  }
  
  // If path is too short, use the deepest non-leaf node (second to last)
  if (names.length >= 2) {
    return names[names.length - 2];
  }
  
  return names[0] || 'Unknown';
}

/**
 * Store original path information in tree nodes during construction.
 * This allows us to compute groupKey later.
 */
export function enrichTreeWithPaths(treeData, rows) {
  const normalizedRows = rows.map(r => ({
    ...r,
    ids_root_to_leaf: Array.isArray(r.ids_root_to_leaf) ? r.ids_root_to_leaf : [],
    names_root_to_leaf: Array.isArray(r.names_root_to_leaf) ? r.names_root_to_leaf : [],
  }));
  
  // Build a map from node id to its path
  const idToPath = new Map();
  for (const r of normalizedRows) {
    for (let i = 0; i < r.ids_root_to_leaf.length; i++) {
      const id = r.ids_root_to_leaf[i];
      if (!idToPath.has(id)) {
        idToPath.set(id, {
          ids: r.ids_root_to_leaf.slice(0, i + 1),
          names: r.names_root_to_leaf.slice(0, i + 1),
        });
      }
    }
  }
  
  // Recursively add path info to tree nodes
  function addPaths(node) {
    const path = idToPath.get(node.id);
    if (path) {
      node.pathIds = path.ids;
      node.pathNames = path.names;
    }
    if (node.children) {
      node.children.forEach(addPaths);
    }
  }
  
  addPaths(treeData);
  return treeData;
}

/**
 * Compute groupKey for a leaf node based on its path.
 * node is a d3.hierarchy node, so we access data via node.data
 */
function getGroupKey(node, groupDepth = 3) {
  if (!node || !node.data) return 'Unknown';
  
  // Try to get pathNames from node.data
  const pathNames = node.data.pathNames;
  if (pathNames && Array.isArray(pathNames) && pathNames.length > 0) {
    const family = inferFamilyFromPath(pathNames, groupDepth);
    if (family) return family;
  }
  
  // Fallback: traverse up the hierarchy to find a suitable ancestor
  // Count depth from root (root is depth 0)
  let current = node;
  let depthFromLeaf = 0;
  const ancestors = [];
  while (current) {
    ancestors.push(current);
    current = current.parent;
  }
  // ancestors[0] is the node itself, ancestors[ancestors.length-1] is root
  // We want the node at depth = groupDepth from root
  const targetIndex = ancestors.length - 1 - groupDepth;
  if (targetIndex >= 0 && targetIndex < ancestors.length) {
    const targetNode = ancestors[targetIndex];
    if (targetNode && targetNode.data && targetNode.data.name) {
      return targetNode.data.name;
    }
  }
  
  // Last resort: use the node's own name
  return node.data.name || 'Unknown';
}

/**
 * Sort leaves by groupKey, then by name within each group.
 * Returns a map from leaf node to its target index.
 */
export function computeLeafOrder(root, groupDepth = 3) {
  const leaves = root.leaves();
  
  // Compute groupKey for each leaf
  const leafGroups = leaves.map(leaf => ({
    leaf,
    groupKey: getGroupKey(leaf, groupDepth),
    name: leaf.data.name || '',
  }));
  
  // Sort: first by groupKey, then by name
  leafGroups.sort((a, b) => {
    const groupCmp = (a.groupKey || '').localeCompare(b.groupKey || '');
    if (groupCmp !== 0) return groupCmp;
    return (a.name || '').localeCompare(b.name || '');
  });
  
  // Create a map from leaf to its sorted index
  const leafToIndex = new Map();
  leafGroups.forEach((item, index) => {
    leafToIndex.set(item.leaf, index);
  });
  
  return { leafToIndex, leafGroups };
}

export function reorderTreeForGrouping(root) {
  // For each internal node, sort its children alphabetically
  // This guarantees zero branch crossings while still naturally grouping identical taxa prefixes
  function sortNodeChildren(node) {
    if (!node.children || node.children.length === 0) return;
    
    node.children.sort((a, b) => {
      const nameA = (a.data.name || '').toLowerCase();
      const nameB = (b.data.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    node.children.forEach(sortNodeChildren);
  }
  
  sortNodeChildren(root);
  return root;
}

