const DEFAULT_GROUP_ID = 'MAM';
const DEFAULT_OVERVIEW_DEPTH = 4;
const ORPHAN_GROUP_START_ID = -1000000;

function shouldIncludeRowForTaxonType(row, currentTaxonType, nonBioGroups) {
  const group = row.taxagroupid || '';
  if (currentTaxonType === 'nonbio') return nonBioGroups.has(group);
  return !nonBioGroups.has(group);
}

function getOverviewPathLimit(row, anchorDataMap, syntheticGroupRoots) {
  const ids = row.ids_root_to_leaf || [];
  const taxagroupid = row.taxagroupid;

  if (anchorDataMap.has(taxagroupid)) {
    const anchor = anchorDataMap.get(taxagroupid);
    const anchorId = parseInt(anchor.anchorId);
    const independentIds = (anchor.independentPaths || []).map((path) => parseInt(path.id));

    const anchorIndex = ids.indexOf(anchorId);
    if (anchorIndex !== -1) return anchorIndex + 1;

    const independentIndex = ids.findIndex((id) => independentIds.includes(id));
    if (independentIndex !== -1) return independentIndex + 1;

    return null;
  }

  return syntheticGroupRoots[taxagroupid]?.overviewDepth || DEFAULT_OVERVIEW_DEPTH;
}

function buildChildren(parentNode, level, levelMap, idToTaxagroupid, anchorIds, isOrphan = false) {
  const nextLevel = levelMap.get(level + 1);
  if (!nextLevel) return;

  parentNode.children = [];
  const parentData = levelMap.get(level).get(parentNode.id);
  const childrenSet = parentData?.children || new Set();

  childrenSet.forEach((childId) => {
    const childData = nextLevel.get(childId);
    const isOrphanNode = childData && childData.pathCount === 1 && childData.children.size === 0;
    const shouldInclude = isOrphan
      ? isOrphanNode
      : (childData && (childData.children.size > 0 || level === 2 || childData.pathCount > 1));

    if (!childData || !shouldInclude) return;

    const childTaxagroupids = Array.from(childData.taxagroupids);
    const childTaxagroupid = childTaxagroupids[0] || idToTaxagroupid.get(childId) || DEFAULT_GROUP_ID;
    const childNode = {
      id: childId,
      name: childData.name,
      taxagroupid: childTaxagroupid,
      isAnchor: anchorIds.has(childId) || anchorIds.has(parseInt(childId)),
      children: [],
    };

    buildChildren(childNode, level + 1, levelMap, idToTaxagroupid, anchorIds, isOrphan);
    parentNode.children.push(childNode);
  });

  if (parentNode.children.length === 0) delete parentNode.children;
}

function hasOrphanDescendants(nodeId, level, levelMap) {
  if (level >= 6) return false;
  const nodeData = levelMap.get(level)?.get(nodeId);
  if (!nodeData) return false;

  if (level > 0 && nodeData.pathCount === 1 && nodeData.children.size === 0) return true;

  for (const childId of nodeData.children) {
    if (hasOrphanDescendants(childId, level + 1, levelMap)) return true;
  }
  return false;
}

function buildStandaloneOrphanTree(standaloneOrphans) {
  const orphanTreeByGroup = new Map();
  let orphanGroupIdCounter = ORPHAN_GROUP_START_ID;

  standaloneOrphans.forEach((orphan) => {
    const group = orphan.taxagroupid || DEFAULT_GROUP_ID;
    if (!orphanTreeByGroup.has(group)) {
      orphanTreeByGroup.set(group, {
        id: orphanGroupIdCounter--,
        name: group,
        taxagroupid: group,
        children: [],
      });
    }

    orphanTreeByGroup.get(group).children.push({
      id: orphan.id,
      name: orphan.name,
      taxagroupid: orphan.taxagroupid,
      children: [],
    });
  });

  return Array.from(orphanTreeByGroup.values()).filter((groupRoot) => groupRoot.children.length > 0);
}

export function buildInitialTrees(
  rows,
  {
    currentTaxonType = 'bio',
    nonBioGroups = new Set(),
    anchorDataMap = new Map(),
    anchorIds = new Set(),
    syntheticGroupRoots = {},
  } = {},
) {
  const rowsForType = rows.filter((row) => shouldIncludeRowForTaxonType(row, currentTaxonType, nonBioGroups));
  const levelMap = new Map();
  const idToTaxagroupid = new Map();
  const standaloneOrphans = [];

  rowsForType.forEach((row) => {
    const ids = row.ids_root_to_leaf || [];
    const names = row.names_root_to_leaf || [];
    const taxagroupid = row.taxagroupid;

    if (ids.length === 1 && names.length === 1) {
      standaloneOrphans.push({
        id: ids[0],
        name: names[0],
        taxagroupid: taxagroupid || DEFAULT_GROUP_ID,
        taxonid: row.taxonid,
        taxonname: row.taxonname,
      });
      return;
    }

    const pathLimit = getOverviewPathLimit(row, anchorDataMap, syntheticGroupRoots);
    if (pathLimit == null || ids.length < pathLimit || names.length < pathLimit) return;

    for (let i = 0; i < Math.min(pathLimit, ids.length); i++) {
      const id = ids[i];
      const name = names[i];

      if (!levelMap.has(i)) levelMap.set(i, new Map());

      const levelData = levelMap.get(i);
      if (!levelData.has(id)) {
        levelData.set(id, {
          id,
          name,
          taxagroupids: new Set(),
          isAnchor: anchorIds.has(id),
          children: new Set(),
          pathCount: 0,
        });
      }

      if (taxagroupid) {
        levelData.get(id).taxagroupids.add(taxagroupid);
        idToTaxagroupid.set(id, taxagroupid);
      }

      levelData.get(id).pathCount++;

      if (i > 0) {
        const parentId = ids[i - 1];
        const parentData = levelMap.get(i - 1);
        if (parentData && parentData.has(parentId)) parentData.get(parentId).children.add(id);
      }
    }
  });

  const mainTree = [];
  const orphanTree = [];
  const rootLevel = levelMap.get(0);

  if (rootLevel) {
    rootLevel.forEach((nodeData, id) => {
      const taxagroupids = Array.from(nodeData.taxagroupids);
      const taxagroupid = taxagroupids[0] || DEFAULT_GROUP_ID;

      if (nodeData.children.size > 0) {
        const node = { id, name: nodeData.name, taxagroupid, children: [] };
        buildChildren(node, 0, levelMap, idToTaxagroupid, anchorIds, false);
        if (node.children && node.children.length > 0) mainTree.push(node);
      }

      if (hasOrphanDescendants(id, 0, levelMap)) {
        const orphanNode = { id, name: nodeData.name, taxagroupid, children: [] };
        buildChildren(orphanNode, 0, levelMap, idToTaxagroupid, anchorIds, true);
        if (orphanNode.children && orphanNode.children.length > 0) orphanTree.push(orphanNode);
      }
    });
  }

  orphanTree.push(...buildStandaloneOrphanTree(standaloneOrphans));

  return { mainTree, orphanTree, standaloneOrphans };
}

export function initialTreeNodesToRows(rootNodes) {
  const rows = [];

  rootNodes.forEach((root) => {
    function traverse(node, pathIds = [], pathNames = []) {
      const newPathIds = [...pathIds, node.id];
      const newPathNames = [...pathNames, node.name];

      if (node.children && node.children.length > 0) {
        node.children.forEach((child) => traverse(child, newPathIds, newPathNames));
        return;
      }

      rows.push({
        taxonid: node.id,
        taxonname: node.name,
        ids_root_to_leaf: newPathIds,
        names_root_to_leaf: newPathNames,
        taxagroupid: node.taxagroupid,
      });
    }

    traverse(root);
  });

  return rows;
}
