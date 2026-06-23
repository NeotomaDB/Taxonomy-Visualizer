const DEFAULT_ROOT_ID = 32182;
const DEFAULT_ROOT_NAME = 'Root';
const DEFAULT_GROUP_ID = 'MAM';

export function extractTaxaGroups(rows) {
  const groups = new Set();
  rows.forEach((row) => {
    if (row.taxagroupid) groups.add(row.taxagroupid);
  });
  return Array.from(groups).sort();
}

export function buildTaxonomyIndexes(rows) {
  const rowsByGroup = new Map();
  const pathsByNodeId = new Map();
  const nameById = new Map();

  rows.forEach((row) => {
    const group = row.taxagroupid || DEFAULT_GROUP_ID;
    if (!rowsByGroup.has(group)) rowsByGroup.set(group, []);
    rowsByGroup.get(group).push(row);

    const ids = row.ids_root_to_leaf || [];
    const names = row.names_root_to_leaf || [];
    ids.forEach((id, index) => {
      if (!pathsByNodeId.has(id)) pathsByNodeId.set(id, []);
      pathsByNodeId.get(id).push(row);
      if (!nameById.has(id) && names[index]) nameById.set(id, names[index]);
    });
  });

  return { rowsByGroup, pathsByNodeId, nameById };
}

export function getRowsForGroup(indexes, taxagroupid) {
  return indexes.rowsByGroup.get(taxagroupid) || [];
}

export function getRowsContainingNode(indexes, nodeId) {
  return indexes.pathsByNodeId.get(nodeId) || [];
}

function getMostCommonRoot(groupRows) {
  const rootCounts = new Map();
  const rootNames = new Map();

  groupRows.forEach((row) => {
    const ids = row.ids_root_to_leaf || [];
    const names = row.names_root_to_leaf || [];
    if (ids.length === 0) return;

    const rootId = ids[0];
    rootCounts.set(rootId, (rootCounts.get(rootId) || 0) + 1);
    if (!rootNames.has(rootId)) rootNames.set(rootId, names[0]);
  });

  let rootId = DEFAULT_ROOT_ID;
  let maxCount = 0;
  rootCounts.forEach((count, candidateRootId) => {
    if (count > maxCount) {
      maxCount = count;
      rootId = candidateRootId;
    }
  });

  return {
    rootId,
    rootName: rootNames.get(rootId) || DEFAULT_ROOT_NAME,
  };
}

export function filterRowsByGroup(indexes, taxagroupid, anchorDataMap = new Map()) {
  if (!taxagroupid) return [];
  const groupRows = getRowsForGroup(indexes, taxagroupid);

  if (anchorDataMap.has(taxagroupid)) {
    const { anchorName } = anchorDataMap.get(taxagroupid);
    return groupRows
      .filter((row) => row.names_root_to_leaf.includes(anchorName))
      .map((row) => {
        const anchorIndex = row.names_root_to_leaf.indexOf(anchorName);
        return {
          ...row,
          ids_root_to_leaf: row.ids_root_to_leaf.slice(anchorIndex),
          names_root_to_leaf: row.names_root_to_leaf.slice(anchorIndex),
        };
      });
  }

  const { rootId } = getMostCommonRoot(groupRows);
  return groupRows.filter((row) => {
    const ids = row.ids_root_to_leaf || [];
    return ids.length > 0 && ids[0] === rootId;
  });
}

export function getRootInfo(indexes, taxagroupid, anchorDataMap = new Map()) {
  if (anchorDataMap.has(taxagroupid)) {
    const anchor = anchorDataMap.get(taxagroupid);
    return {
      rootId: parseInt(anchor.anchorId),
      rootName: anchor.anchorName,
    };
  }

  return getMostCommonRoot(getRowsForGroup(indexes, taxagroupid));
}
