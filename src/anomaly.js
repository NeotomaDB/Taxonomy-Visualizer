/**
 * Anomaly detection for biological taxagroups.
 *
 * Scans normalized rows (names_root_to_leaf as string arrays) and classifies
 * each row into one of two anomaly types, or clean:
 *
 *   Type 1 — wrong_domain: path contains non-eukaryotic domain markers
 *     (e.g. Bacteria, Cyanobacteria). Most severe — record does not belong to
 *     any Eukaryota-based tree.
 *
 *   Type 2 — wrong_kingdom: path contains a kingdom that contradicts
 *     the expected kingdom for this taxagroup (e.g. Animalia in a VPL/Plantae
 *     group). Severe but potentially a legacy classification.
 *
 * Type 3 (incertae sedis / single-node paths) is classified as ORPHAN, not
 * anomaly — see calling code for orphan handling.
 */

// Names indicating a non-eukaryotic domain.
// Checked via exact match against each lowercased path segment.
const PROKARYOTE_DOMAIN_MARKERS = new Set([
  'bacteria',
  'cyanobacteria',
  'prokaryota',
  'prokaryote',
  'prokaryotes',
  'archaea',
  'archaeota',
  'firmicutes',
  'proteobacteria',
  'actinobacteria',
  'actinobacteriota',
  'spirochaetes',
  'bacteroidetes',
  'chloroflexi',
  'planctomycetes',
  'acidobacteria',
  'verrucomicrobia',
  'negibacteria',
  'cyanophyceae',
  'nostocophycidae',
]);

/**
 * Per-taxagroup constraints.
 *
 * domain          — 'eukaryota' triggers Type 1 check (prokaryote marker scan)
 * wrongKingdoms   — Set of kingdom names (lowercase) whose presence flags Type 2
 * expectedKingdomLabel — Human-readable label for the expected kingdom (for UI)
 */
const TAXAGROUP_CONSTRAINTS = {
  // ── Plant groups: expect Plantae ─────────────────────────────────────────
  VPL: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['animalia', 'fungi']),
    expectedKingdomLabel: 'Plantae',
  },
  BRY: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['animalia', 'fungi']),
    expectedKingdomLabel: 'Plantae',
  },
  // ── Animal groups: expect Animalia ───────────────────────────────────────
  MAM: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['plantae', 'fungi']),
    expectedKingdomLabel: 'Animalia',
  },
  AVE: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['plantae', 'fungi']),
    expectedKingdomLabel: 'Animalia',
  },
  REP: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['plantae', 'fungi']),
    expectedKingdomLabel: 'Animalia',
  },
  AMP: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['plantae', 'fungi']),
    expectedKingdomLabel: 'Animalia',
  },
  FSH: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['plantae', 'fungi']),
    expectedKingdomLabel: 'Animalia',
  },
  INS: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['plantae', 'fungi']),
    expectedKingdomLabel: 'Animalia',
  },
  // ── Plant groups with broader taxonomy ──────────────────────────────────
  PLA: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['animalia', 'fungi']),
    expectedKingdomLabel: 'Plantae',
  },
  // ── Algae: spans Plantae + Chromista legitimately; Type 1 only ──────────
  ALG: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(),
    expectedKingdomLabel: null,
  },
  // ── Dinoflagellates: expect Chromista ────────────────────────────────────
  DIN: {
    domain: 'eukaryota',
    wrongKingdoms: new Set(['plantae', 'animalia', 'fungi']),
    expectedKingdomLabel: 'Chromista',
  },
};

/**
 * Detect anomalous rows for a given taxagroup.
 *
 * @param {Array}  normalizedRows  Rows after normalizeRows() — must have
 *                                 names_root_to_leaf as a string array.
 * @param {string} taxagroupid
 * @returns {{ cleanRows: Array, anomalies: AnomalyRecord[] }}
 *
 * AnomalyRecord: {
 *   taxonid:     number,
 *   taxonname:   string,
 *   anomalyType: 'wrong_domain' | 'wrong_kingdom',
 *   actualPath:  string  (names joined by ' → '),
 *   detail:      string  (human-readable explanation),
 * }
 */
export function detectAnomalies(normalizedRows, taxagroupid) {
  const constraint = TAXAGROUP_CONSTRAINTS[taxagroupid];

  // No constraint defined → no anomaly detection for this group
  if (!constraint) {
    return { cleanRows: normalizedRows, anomalies: [] };
  }

  const anomalies = [];
  const cleanRows = [];

  for (const row of normalizedRows) {
    const names = row.names_root_to_leaf || [];

    if (names.length === 0) {
      cleanRows.push(row);
      continue;
    }

    const lowerNames = names.map(n => (n || '').toLowerCase().trim());
    let anomalyType = null;
    let anomalyDetail = null;

    // ── Type 1: Wrong domain ──────────────────────────────────────────────
    if (constraint.domain === 'eukaryota') {
      for (let i = 0; i < lowerNames.length; i++) {
        if (PROKARYOTE_DOMAIN_MARKERS.has(lowerNames[i])) {
          anomalyType = 'wrong_domain';
          anomalyDetail = `Path contains "${names[i]}" — not under Eukaryota`;
          break;
        }
      }
    }

    // ── Type 2: Wrong kingdom ─────────────────────────────────────────────
    if (!anomalyType && constraint.wrongKingdoms) {
      for (let i = 0; i < lowerNames.length; i++) {
        if (constraint.wrongKingdoms.has(lowerNames[i])) {
          anomalyType = 'wrong_kingdom';
          anomalyDetail =
            `Path contains "${names[i]}" — expected ${constraint.expectedKingdomLabel}`;
          break;
        }
      }
    }

    if (anomalyType) {
      anomalies.push({
        taxonid: row.taxonid,
        taxonname: row.taxonname,
        anomalyType,
        actualPath: names.join(' → '),
        detail: anomalyDetail,
      });
    } else {
      cleanRows.push(row);
    }
  }

  return { cleanRows, anomalies };
}

/**
 * Visual styling metadata for each anomaly type.
 * Used by the UI to render badges and table rows.
 */
export function getAnomalyMeta(anomalyType) {
  switch (anomalyType) {
    case 'wrong_domain':
      return {
        label: 'wrong domain',
        color: '#dc2626',   // red-600
        bg: '#fef2f2',   // red-50
        border: '#fca5a5',   // red-300
      };
    case 'wrong_kingdom':
      return {
        label: 'wrong kingdom',
        color: '#d97706',   // amber-600
        bg: '#fffbeb',   // amber-50
        border: '#fcd34d',   // amber-300
      };
    default:
      return {
        label: anomalyType,
        color: '#6b7280',
        bg: '#f9fafb',
        border: '#e5e7eb',
      };
  }
}
