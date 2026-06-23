import { detectAnomalies } from './anomaly.js';

export function findShortValidRows(allGroupRows, filteredRows, anomalies) {
  const anomalyIds = new Set(anomalies.map((anomaly) => anomaly.taxonid));
  const filteredRowIds = new Set(filteredRows.map((row) => row.taxonid));

  return allGroupRows.filter((row) => (
    !anomalyIds.has(row.taxonid) && !filteredRowIds.has(row.taxonid)
  ));
}

export function findShallowOrphans(filteredRows) {
  const allParentIds = new Set();

  filteredRows.forEach((row) => {
    const ids = row.ids_root_to_leaf || [];
    for (let i = 0; i < ids.length - 1; i++) {
      allParentIds.add(ids[i]);
    }
  });

  return filteredRows.filter((row) => {
    const names = row.names_root_to_leaf || [];
    const taxonid = row.taxonid;
    return names.length <= 2 && !allParentIds.has(taxonid);
  });
}

export function removeRowsByTaxonId(rows, rowsToRemove) {
  const removeIds = new Set(rowsToRemove.map((row) => row.taxonid));
  return rows.filter((row) => !removeIds.has(row.taxonid));
}

export function resolveGroupAnomalyRows(allGroupRows, filteredRows, taxagroupid) {
  const { anomalies } = detectAnomalies(allGroupRows, taxagroupid);
  const shortValidRows = findShortValidRows(allGroupRows, filteredRows, anomalies);
  const shallowOrphans = findShallowOrphans(filteredRows);

  return {
    anomalies,
    orphanNodes: [...shortValidRows, ...shallowOrphans],
    filteredRows: removeRowsByTaxonId(filteredRows, shallowOrphans),
    shortValidRows,
    shallowOrphans,
  };
}
