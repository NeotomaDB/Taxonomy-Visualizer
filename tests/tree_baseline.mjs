/** Build deterministic tree snapshots with the current production tree builder. */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expandCompactTaxonPaths, normalizeRows, pathsToTree } from '../src/data.js';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TESTS_DIR);
const DATA_DIR = path.join(ROOT, 'data');

export const TREE_GOLDEN = path.join(TESTS_DIR, 'golden', 'tree_structure_baseline.json');
export const SMALL_TREE_GOLDEN = path.join(TESTS_DIR, 'golden', 'trees', 'ACR.json');

const BUILTIN_ANCHORS = {
  VPL: { anchorName: 'Tracheophyta', anchorId: 9534 },
  DIN: { anchorName: 'Miozoa', anchorId: 32187 },
  AVE: { anchorName: 'Aves', anchorId: 5856 },
  DIA: { anchorName: 'Bacillariophyta', anchorId: 5396 },
  OST: { anchorName: 'Ostracoda', anchorId: 13914 },
};

const SYNTHETIC_GROUP_ROOTS = {
  BRY: { rootId: -2001, rootName: 'Bryophytes', sliceAfterName: 'Embryophyta' },
  PLA: { rootId: -2002, rootName: 'Plants undiff.', sliceAfterName: 'Plantae' },
  VPL: { rootId: -2003, rootName: 'Vascular plants', sliceAfterName: 'Embryophyta' },
};

const GROUP_OVERVIEW_CONFIG = {
  INS: { rootId: 0, rootName: 'Root' },
};

function loadCurrentInputs() {
  const anchors = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'anchor_analysis.json'), 'utf8'));
  const anchorMap = new Map(anchors.map((anchor) => [anchor.taxagroupid, anchor]));
  for (const [groupId, anchor] of Object.entries(BUILTIN_ANCHORS)) {
    if (!anchorMap.has(groupId)) anchorMap.set(groupId, { taxagroupid: groupId, ...anchor });
  }
  const paths = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'taxon_paths_ids.json'), 'utf8'));
  const names = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'taxon_names.json'), 'utf8'));
  return { rows: expandCompactTaxonPaths(paths, names), anchorMap };
}

function mostCommonRoot(rows) {
  const counts = new Map();
  const names = new Map();
  for (const row of rows) {
    if (!row.ids_root_to_leaf.length) continue;
    const rootId = row.ids_root_to_leaf[0];
    counts.set(rootId, (counts.get(rootId) || 0) + 1);
    if (!names.has(rootId)) names.set(rootId, row.names_root_to_leaf[0]);
  }
  let rootId = 32182;
  let maxCount = 0;
  for (const [candidate, count] of counts) {
    if (count > maxCount) {
      rootId = candidate;
      maxCount = count;
    }
  }
  return { rootId, rootName: names.get(rootId) || 'Root' };
}

function prepareGroupRows(allRows, anchorMap, groupId) {
  const groupRows = allRows.filter((row) => row.taxagroupid === groupId);
  const synthetic = SYNTHETIC_GROUP_ROOTS[groupId];
  if (synthetic) {
    const rows = groupRows
      .filter((row) => row.names_root_to_leaf.includes(synthetic.sliceAfterName))
      .map((row) => {
        const index = row.names_root_to_leaf.indexOf(synthetic.sliceAfterName);
        return {
          ...row,
          ids_root_to_leaf: [synthetic.rootId, ...row.ids_root_to_leaf.slice(index + 1)],
          names_root_to_leaf: [synthetic.rootName, ...row.names_root_to_leaf.slice(index + 1)],
        };
      })
      .filter((row) => row.ids_root_to_leaf.length > 1);
    return { rows, rootId: synthetic.rootId, rootName: synthetic.rootName };
  }

  const overview = GROUP_OVERVIEW_CONFIG[groupId];
  if (overview) {
    const rows = groupRows
      .filter((row) => row.ids_root_to_leaf.length && row.names_root_to_leaf.length)
      .map((row) => ({
        ...row,
        ids_root_to_leaf: [overview.rootId, ...row.ids_root_to_leaf],
        names_root_to_leaf: [overview.rootName, ...row.names_root_to_leaf],
      }));
    return { rows, rootId: overview.rootId, rootName: overview.rootName };
  }

  const anchor = anchorMap.get(groupId);
  if (anchor) {
    const rootId = Number.parseInt(anchor.anchorId, 10);
    const rows = groupRows
      .filter((row) => row.names_root_to_leaf.includes(anchor.anchorName))
      .map((row) => {
        const index = row.names_root_to_leaf.indexOf(anchor.anchorName);
        return {
          ...row,
          ids_root_to_leaf: row.ids_root_to_leaf.slice(index),
          names_root_to_leaf: row.names_root_to_leaf.slice(index),
        };
      });
    return { rows, rootId, rootName: anchor.anchorName };
  }

  const root = mostCommonRoot(groupRows);
  const rows = groupRows.filter((row) => row.ids_root_to_leaf[0] === root.rootId);
  return { rows, ...root };
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonicalizeTree(root) {
  const records = [];
  let maxDepth = 0;
  const visit = (node, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const children = [...(node.children || [])].sort((a, b) => Number(a.id) - Number(b.id));
    records.push({
      id: Number(node.id),
      name: String(node.name),
      child_ids: children.map((child) => Number(child.id)),
      leaf_count: Number(node.leafCount),
    });
    children.forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
  records.sort((a, b) => a.id - b.id);
  return { records, maxDepth };
}

export function getAllTaxagroupIds() {
  const { rows } = loadCurrentInputs();
  return [...new Set(rows.map((row) => row.taxagroupid).filter(Boolean))].sort();
}

export function buildTreeBaselines(groupIds = getAllTaxagroupIds()) {
  const { rows: allRows, anchorMap } = loadCurrentInputs();
  const anchorIds = new Set([...anchorMap.values()].map((anchor) => Number(anchor.anchorId)));
  const groups = {};
  let smallTree = null;

  for (const groupId of groupIds) {
    const prepared = prepareGroupRows(allRows, anchorMap, groupId);
    const normalized = normalizeRows(prepared.rows);
    const { root } = pathsToTree(
      normalized,
      prepared.rootId,
      prepared.rootName,
      anchorIds,
    );
    const canonical = canonicalizeTree(root);
    const edgeCount = canonical.records.reduce((sum, node) => sum + node.child_ids.length, 0);
    groups[groupId] = {
      input_row_count: prepared.rows.length,
      root_id: Number(root.id),
      root_name: String(root.name),
      node_count: canonical.records.length,
      edge_count: edgeCount,
      leaf_count: Number(root.leafCount),
      max_depth: canonical.maxDepth,
      structure_sha256: sha256(canonical.records.map((record) => ({
        id: record.id,
        child_ids: record.child_ids,
        leaf_count: record.leaf_count,
      }))),
      records_sha256: sha256(canonical.records),
    };
    if (groupId === 'ACR') smallTree = { group: groupId, ...canonical };
  }

  return {
    summary: {
      schema_version: 1,
      source: 'compact taxonomy payload + src/data.js pathsToTree',
      representative_groups: groupIds,
      groups,
    },
    smallTree,
  };
}

export function writeTreeBaselines() {
  const { summary, smallTree } = buildTreeBaselines();
  fs.mkdirSync(path.dirname(SMALL_TREE_GOLDEN), { recursive: true });
  fs.writeFileSync(TREE_GOLDEN, `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(SMALL_TREE_GOLDEN, `${JSON.stringify(smallTree, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) writeTreeBaselines();
