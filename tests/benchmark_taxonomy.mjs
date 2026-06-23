import fs from 'node:fs';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';

import { expandCompactTaxonPaths } from '../src/data.js';

const RUNS = 7;
const namesRaw = fs.readFileSync('data/taxon_names.json', 'utf8');
const pathsRaw = fs.readFileSync('data/taxon_paths_ids.json', 'utf8');
// Recorded immediately before taxonpaths.json was retired. Keep these constants
// stable so future compact-format runs remain comparable to the migration baseline.
const LEGACY_BASELINE = {
  payload_bytes: 21_195_711,
  gzip_bytes: 1_423_070,
  median_ms: 307.9,
  median_heap_mb: 56.5,
};

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function benchmark(loadRows) {
  const times = [];
  const heapDeltas = [];
  for (let index = 0; index < RUNS; index += 1) {
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    let rows = loadRows();
    times.push(performance.now() - start);
    global.gc?.();
    heapDeltas.push(process.memoryUsage().heapUsed - heapBefore);
    if (rows.length !== 58897) throw new Error(`Unexpected row count: ${rows.length}`);
    rows = null;
  }
  return {
    median_ms: Number(median(times).toFixed(1)),
    min_ms: Number(Math.min(...times).toFixed(1)),
    max_ms: Number(Math.max(...times).toFixed(1)),
    median_heap_mb: Number((median(heapDeltas) / 1e6).toFixed(1)),
  };
}

const split = benchmark(() => expandCompactTaxonPaths(JSON.parse(pathsRaw), JSON.parse(namesRaw)));
const newBytes = Buffer.byteLength(namesRaw) + Buffer.byteLength(pathsRaw);
const newGzipBytes = zlib.gzipSync(namesRaw, { level: 6 }).length
  + zlib.gzipSync(pathsRaw, { level: 6 }).length;

console.log(JSON.stringify({
  runs: RUNS,
  recorded_legacy_baseline: LEGACY_BASELINE,
  payload: {
    legacy_mb: Number((LEGACY_BASELINE.payload_bytes / 1e6).toFixed(2)),
    split_mb: Number((newBytes / 1e6).toFixed(2)),
    raw_reduction_percent: Number(((1 - newBytes / LEGACY_BASELINE.payload_bytes) * 100).toFixed(1)),
    legacy_gzip_mb: Number((LEGACY_BASELINE.gzip_bytes / 1e6).toFixed(2)),
    split_gzip_mb: Number((newGzipBytes / 1e6).toFixed(2)),
    gzip_reduction_percent: Number(((1 - newGzipBytes / LEGACY_BASELINE.gzip_bytes) * 100).toFixed(1)),
  },
  parse_and_expand: {
    split,
    median_speedup: Number((LEGACY_BASELINE.median_ms / split.median_ms).toFixed(1)),
    heap_reduction_percent: Number(
      ((1 - split.median_heap_mb / LEGACY_BASELINE.median_heap_mb) * 100).toFixed(1),
    ),
  },
}, null, 2));
