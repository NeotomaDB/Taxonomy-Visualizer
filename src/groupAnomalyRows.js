import { detectAnomalies } from './anomaly.js';

export const TAXONOMIC_ISSUE_TYPES = Object.freeze({
  UNPLACED: 'unplaced',
  SHALLOW_PLACEMENT: 'shallow_placement',
  MISSING_SUBORDINATE_DATA: 'missing_subordinate_data',
  PLACEMENT_CONFLICT: 'placement_conflict',
});

function buildParentTaxonIds(rows) {
  const parentIds = new Set();

  rows.forEach((row) => {
    const ids = row.ids_root_to_leaf || [];
    for (let index = 0; index < ids.length - 1; index += 1) {
      parentIds.add(ids[index]);
    }
  });

  return parentIds;
}

function toIssue(row, issueType, suggestedNextStep, extra = {}) {
  return {
    taxonid: row.taxonid,
    taxonname: row.taxonname,
    taxagroupid: row.taxagroupid,
    names_root_to_leaf: row.names_root_to_leaf || [],
    issueType,
    suggestedNextStep,
    ...extra,
  };
}

/**
 * A taxon is unplaced only when its recorded path contains the taxon itself
 * and no parent. A one-node path that acts as the parent of other taxa is a
 * legitimate root and must not be reported as unplaced.
 */
export function findUnplacedTaxa(rows) {
  const parentIds = buildParentTaxonIds(rows);

  return rows.filter((row) => {
    const ids = row.ids_root_to_leaf || [];
    return ids.length === 1 && !parentIds.has(row.taxonid);
  });
}

/**
 * A shallow placement is a terminal taxon recorded directly below a root or
 * similarly broad parent. It is a review candidate, not a confirmed error.
 */
export function findShallowPlacements(rows) {
  const parentIds = buildParentTaxonIds(rows);

  return rows.filter((row) => {
    const ids = row.ids_root_to_leaf || [];
    return ids.length === 2 && !parentIds.has(row.taxonid);
  });
}

/**
 * Missing subordinate data cannot be inferred from a taxon merely being a
 * leaf. Only rows explicitly marked by a rank-aware data rule are included.
 */
export function findMissingSubordinateData(rows) {
  const parentIds = buildParentTaxonIds(rows);

  return rows.filter((row) => (
    row.expects_subordinate_data === true && !parentIds.has(row.taxonid)
  ));
}

export function removeRowsByTaxonId(rows, rowsToRemove) {
  const removeIds = new Set(rowsToRemove.map((row) => row.taxonid));
  return rows.filter((row) => !removeIds.has(row.taxonid));
}

export function resolveGroupAnomalyRows(
  allGroupRows,
  filteredRows,
  taxagroupid,
  {
    classificationRows = filteredRows,
    // Invalid synonym records are deliberate name-resolution records, not
    // placement problems. Keep this dependency injectable so this module
    // remains deterministic and does not need to load the synonym dataset.
    isInvalidSynonym = () => false,
  } = {},
) {
  const isReviewableTaxon = (row) => !isInvalidSynonym(row.taxonid);
  const synonymRows = allGroupRows.filter((row) => !isReviewableTaxon(row));
  const reviewableGroupRows = allGroupRows.filter(isReviewableTaxon);
  const reviewableClassificationRows = classificationRows.filter(isReviewableTaxon);

  const { anomalies } = detectAnomalies(reviewableGroupRows, taxagroupid);
  const anomalyIds = new Set(anomalies.map((anomaly) => anomaly.taxonid));
  const unplacedCandidateRows = reviewableGroupRows.filter((row) => !anomalyIds.has(row.taxonid));
  const placementCandidateRows = reviewableClassificationRows
    .filter((row) => !anomalyIds.has(row.taxonid));

  const unplacedTaxa = findUnplacedTaxa(unplacedCandidateRows);
  const shallowPlacements = findShallowPlacements(placementCandidateRows);
  const missingSubordinateData = findMissingSubordinateData(placementCandidateRows);

  const issues = [
    ...unplacedTaxa.map((row) => toIssue(
      row,
      TAXONOMIC_ISSUE_TYPES.UNPLACED,
      'Assign the appropriate parent taxon.',
    )),
    ...shallowPlacements.map((row) => toIssue(
      row,
      TAXONOMIC_ISSUE_TYPES.SHALLOW_PLACEMENT,
      'Review whether a more specific parent is available.',
    )),
    ...missingSubordinateData.map((row) => toIssue(
      row,
      TAXONOMIC_ISSUE_TYPES.MISSING_SUBORDINATE_DATA,
      'Confirm the expected child taxa and add the missing records.',
    )),
    ...anomalies.map((anomaly) => ({
      taxonid: anomaly.taxonid,
      taxonname: anomaly.taxonname,
      taxagroupid,
      names_root_to_leaf: anomaly.actualPath ? anomaly.actualPath.split(' → ') : [],
      issueType: TAXONOMIC_ISSUE_TYPES.PLACEMENT_CONFLICT,
      suggestedNextStep: 'Compare the recorded path with the reference taxonomy.',
      anomalyType: anomaly.anomalyType,
      detail: anomaly.detail,
    })),
  ];

  return {
    anomalies,
    issues,
    synonymRows,
    unplacedTaxa,
    shallowPlacements,
    missingSubordinateData,
    // A taxonomy record belongs in exactly one steward surface: the primary
    // canvas, the synonym relationship panel, or the issue queue.
    filteredRows: removeRowsByTaxonId(filteredRows, [...issues, ...synonymRows]),
  };
}
