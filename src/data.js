// Data transformations: parse exported paths, normalize rows, and build hierarchy

const SYNTHETIC_PATH_NODES = {
  FSH: { afterId: 6757, id: 999999, name: 'Fish (Synthetic)' },
  HRP: { afterId: 6757, id: 999998, name: 'Reptiles and amphil (Synthetic)' },
  VER: { afterId: 6757, id: 999997, name: 'Vertebrates undiff. (Synthetic)' },
};

export function expandCompactTaxonPaths(payload, taxonNames) {
  const rows = Array.isArray(payload?.paths) ? payload.paths : [];
  const namesById = taxonNames || {};

  return rows.map(([taxagroupid, pathIds]) => {
    const ids = Array.isArray(pathIds)
      ? pathIds.map(Number).filter(Number.isFinite)
      : [];
    const names = ids.map((id) => namesById[String(id)] ?? String(id));
    const synthetic = SYNTHETIC_PATH_NODES[taxagroupid];

    if (synthetic) {
      const index = ids.indexOf(synthetic.afterId);
      if (index !== -1 && index < ids.length - 1 && ids[index + 1] !== synthetic.id) {
        ids.splice(index + 1, 0, synthetic.id);
        names.splice(index + 1, 0, synthetic.name);
      }
    } else if (taxagroupid === 'ALG' && ids[0] !== 999996) {
      ids.unshift(999996);
      names.unshift('Algae (Group)');
    }

    const taxonid = ids[ids.length - 1];
    return {
      taxonid,
      taxonname: namesById[String(taxonid)] ?? String(taxonid),
      ids_root_to_leaf: ids,
      names_root_to_leaf: names,
      taxagroupid,
    };
  });
}

function parseIdPath(value) {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value !== 'string') return [];
  const s = value.trim();
  if (s.startsWith('[')) { try { return JSON.parse(s).map(Number); } catch { return []; } }
  if (s.startsWith('{') && s.endsWith('}')) {
    const tokens = s.slice(1, -1).split(',').map(t => t.trim()).filter(Boolean);
    const result = [];
    let acc = '';
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].replace(/[^0-9]/g, '');
      if (!t) continue;
      if (acc.length + t.length <= 5) acc += t; else { if (acc) result.push(Number(acc)); acc = t; }
      if (acc.length >= 4) {
        const next = tokens[i + 1] ? tokens[i + 1].replace(/[^0-9]/g, '') : '';
        if (!next || acc.length === 5 || (acc.length === 4 && next.length > 1)) { result.push(Number(acc)); acc = ''; }
      }
    }
    if (acc) result.push(Number(acc));
    return result;
  }
  return [];
}

function parseNamePath(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  const s = value.trim();
  if (s.startsWith('[')) { try { return JSON.parse(s).map(String); } catch { return []; } }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1);
    const parts = [];
    let curr = '';
    let inQ = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') { inQ = !inQ; curr += ch; continue; }
      if (ch === ',' && !inQ) { parts.push(curr); curr = ''; continue; }
      curr += ch;
    }
    if (curr) parts.push(curr);
    return parts.map(p => {
      const t = p.trim();
      if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
      return t;
    });
  }
  return [];
}

export function normalizeRows(rows) {
  return rows.map(r => ({
    ...r,
    ids_root_to_leaf: parseIdPath(r.ids_root_to_leaf),
    names_root_to_leaf: parseNamePath(r.names_root_to_leaf),
  }));
}

export function pathsToTree(rows, rootId = 6171, rootName = 'Mammalia', anchorIds = new Set()) {
  const root = { id: rootId, name: rootName, children: [] };
  const byId = new Map([[root.id, root]]);
  const nameDict = new Map();
  for (const r of rows) {
    r.ids_root_to_leaf.forEach((id, i) => {
      const nm = r.names_root_to_leaf[i];
      if (id != null && nm && !nameDict.has(id)) nameDict.set(id, nm);
    });
  }
  for (const r of rows) {
    const ids = r.ids_root_to_leaf;
    const names = r.names_root_to_leaf;
    
    // Find the index of our intended root in the full path
    const rootIndex = ids.indexOf(root.id);
    if (rootIndex === -1) continue;
    
    let parent = root;
    for (let i = rootIndex + 1; i < ids.length; i++) {
      const id = ids[i];
      const name = names[i] ?? nameDict.get(id) ?? String(id);
      let child = byId.get(id);
      if (!child) {
        child = { 
          id, 
          name, 
          children: [],
          isAnchor: anchorIds.has(id) || anchorIds.has(parseInt(id))
        };
        byId.set(id, child);
        (parent.children || (parent.children = [])).push(child);
      }
      parent = child;
    }
  }
  (function prune(n) { if (n.children && n.children.length) n.children.forEach(prune); else delete n.children; })(root);

  // Calculate cumulative leaf counts (actual taxa at the ends of paths)
  (function countLeaves(node) {
    if (!node.children || node.children.length === 0) {
      node.leafCount = 1;
      return 1;
    }
    let sum = 0;
    node.children.forEach(child => {
      sum += countLeaves(child);
    });
    node.leafCount = sum;
    return sum;
  })(root);

  return { root, byId };
}

/**
 * Attach synonym metadata onto canonical nodes in the tree.
 * Invalid synonym names are NOT added as tree nodes — they are stored as
 * `node.synonymMetadata` so the search and info panel can resolve them
 * without polluting the phylogenetic structure.
 *
 * Also builds a reverse lookup map:  invalidId → canonicalId
 * so search can find the canonical node when a user types an invalid name.
 *
 * @param {Object} treeRoot     - The root of the tree (unused but kept for API compat)
 * @param {Map}    byId         - Map of node ID → node object (canonical nodes only)
 * @param {Object} synonymManager - The synonym manager with getSynonymInfo / isReady
 * @param {Array}  allRows      - All available rows (unused but kept for API compat)
 * @returns {Map}  invalidIdToCanonicalId  — reverse lookup for search
 */
export function attachSynonymMetadata(treeRoot, byId, synonymManager, allRows) {
  // Always return a Map (even when synonyms aren't ready) so callers don't need guards
  const invalidIdToCanonicalId = new Map();

  if (!synonymManager || !synonymManager.isReady()) return invalidIdToCanonicalId;

  byId.forEach((node, nodeId) => {
    const synonymInfo = synonymManager.getSynonymInfo(nodeId);
    if (!synonymInfo || !synonymInfo.synonyms || synonymInfo.synonyms.length === 0) return;

    // Only attach on the canonical (valid) node
    if (synonymInfo.validId !== nodeId) return;

    // Store the full synonym info on the canonical node
    node.synonymMetadata = {
      validId: synonymInfo.validId,
      validName: synonymInfo.validName,
      synonyms: synonymInfo.synonyms   // [{invalid_id, invalid_name, synonymtype, recdatemodified}]
    };

    // Build reverse lookup for every invalid ID in this group
    synonymInfo.synonyms.forEach(syn => {
      invalidIdToCanonicalId.set(syn.invalid_id, nodeId);
      // Also map by name (lower-cased) for name-based search resolution
      invalidIdToCanonicalId.set(syn.invalid_name.toLowerCase(), nodeId);
    });
  });

  return invalidIdToCanonicalId;
}

// Keep the old name exported as a no-op alias so any callers that haven't been
// updated yet don't throw a ReferenceError. Will be removed in a later cleanup.
export function addMissingSynonyms() {}
