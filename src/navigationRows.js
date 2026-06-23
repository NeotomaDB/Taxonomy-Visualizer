const DEFAULT_GROUP_ID = 'MAM';
const SYNTHETIC_ROOT_ID = -999999;
const SYNTHETIC_ROOT_NAME = 'Root';

export function sliceRowsFromNode(rows, nodeId) {
  return rows
    .map((row) => {
      const ids = row.ids_root_to_leaf || [];
      const names = row.names_root_to_leaf || [];
      const index = ids.indexOf(nodeId);

      if (index < 0) return row;

      return {
        ...row,
        ids_root_to_leaf: ids.slice(index),
        names_root_to_leaf: names.slice(index),
      };
    })
    .filter((row) => row.ids_root_to_leaf.length > 1);
}

function buildStandaloneOrphanNodes(groupRows, taxagroupid) {
  return groupRows
    .filter((row) => {
      const ids = row.ids_root_to_leaf || [];
      const names = row.names_root_to_leaf || [];
      const rowTaxagroupid = row.taxagroupid || DEFAULT_GROUP_ID;
      return ids.length === 1 && names.length === 1 && rowTaxagroupid === taxagroupid;
    })
    .map((row) => ({
      id: row.ids_root_to_leaf[0],
      name: row.names_root_to_leaf[0],
      taxagroupid: row.taxagroupid || DEFAULT_GROUP_ID,
      children: [],
    }));
}

export function buildNavigationRows({
  nodeId,
  nodeName,
  taxagroupid,
  groupRows,
  rowsContainingNode,
}) {
  const isSyntheticTaxagroupidNode = nodeId < SYNTHETIC_ROOT_ID;

  if (isSyntheticTaxagroupidNode) {
    const rootNode = {
      id: nodeId,
      name: nodeName,
      taxagroupid,
      children: buildStandaloneOrphanNodes(groupRows, taxagroupid),
    };

    return {
      filteredRows: groupRows,
      rootNodesToRender: [rootNode],
      renderRootId: SYNTHETIC_ROOT_ID,
      renderRootName: SYNTHETIC_ROOT_NAME,
      isSyntheticTaxagroupidNode,
    };
  }

  return {
    filteredRows: sliceRowsFromNode(rowsContainingNode, nodeId),
    rootNodesToRender: null,
    renderRootId: nodeId,
    renderRootName: nodeName,
    isSyntheticTaxagroupidNode,
  };
}
