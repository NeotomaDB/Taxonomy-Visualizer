export function buildSyntheticRootRows(groupRows, synth) {
  return groupRows
    .filter((row) => (row.names_root_to_leaf || []).includes(synth.sliceAfterName))
    .map((row) => {
      const index = row.names_root_to_leaf.indexOf(synth.sliceAfterName);
      return {
        ...row,
        ids_root_to_leaf: [synth.rootId, ...row.ids_root_to_leaf.slice(index + 1)],
        names_root_to_leaf: [synth.rootName, ...row.names_root_to_leaf.slice(index + 1)],
      };
    })
    .filter((row) => row.ids_root_to_leaf.length > 1);
}

export function buildGroupOverviewRows(groupRows, overview) {
  return groupRows
    .filter((row) => (row.ids_root_to_leaf || []).length > 0 && (row.names_root_to_leaf || []).length > 0)
    .map((row) => ({
      ...row,
      ids_root_to_leaf: [overview.rootId, ...(row.ids_root_to_leaf || [])],
      names_root_to_leaf: [overview.rootName, ...(row.names_root_to_leaf || [])],
    }));
}

export function resolveGroupTreeRows({
  taxagroupid,
  groupRows,
  syntheticGroupRoots,
  groupOverviewConfig,
  getFilteredRows,
  getRootInfo,
}) {
  let filteredRows;
  let renderRootId;
  let renderRootName;
  let overviewConfig = null;

  if (syntheticGroupRoots[taxagroupid]) {
    const synth = syntheticGroupRoots[taxagroupid];
    filteredRows = buildSyntheticRootRows(groupRows, synth);
    renderRootId = synth.rootId;
    renderRootName = synth.rootName;
  } else if (groupOverviewConfig[taxagroupid]) {
    overviewConfig = groupOverviewConfig[taxagroupid];
    // A forest has multiple legitimate recorded roots. Keep every recorded
    // path unchanged; the renderer supplies an invisible layout container.
    // Non-forest overviews retain the existing display-root behaviour.
    filteredRows = overviewConfig.forest
      ? groupRows.filter((row) =>
          (row.ids_root_to_leaf || []).length > 0 &&
          (row.names_root_to_leaf || []).length > 0)
      : buildGroupOverviewRows(groupRows, overviewConfig);
    renderRootId = overviewConfig.forest
      ? overviewConfig.layoutContainerId
      : overviewConfig.rootId;
    renderRootName = overviewConfig.forest ? '' : overviewConfig.rootName;
  } else {
    filteredRows = getFilteredRows(taxagroupid);
    const rootInfo = getRootInfo(taxagroupid);
    renderRootId = rootInfo.rootId;
    renderRootName = rootInfo.rootName;
  }

  return { filteredRows, renderRootId, renderRootName, overviewConfig };
}
