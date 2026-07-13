const MAX_SUGGESTIONS = 8;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\?+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function boundedEditDistance(a, b, maxDistance) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    let rowMinimum = current[0];
    for (let column = 1; column <= b.length; column += 1) {
      const substitution = previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1);
      const insertion = current[column - 1] + 1;
      const deletion = previous[column] + 1;
      const value = Math.min(substitution, insertion, deletion);
      current[column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

function scoreTerm(query, term) {
  if (term === query) return 0;
  if (term.startsWith(query)) return 10 + term.length / 100;
  if (term.split(' ').some((word) => word.startsWith(query))) return 20 + term.length / 100;
  if (term.includes(query)) return 30 + term.indexOf(query) / 100 + term.length / 1000;

  // Typo matching is intentionally reserved for meaningful input. The first
  // character guard keeps a large taxon group responsive while still covering
  // the common "Mammallia"-style near miss.
  if (query.length < 3 || term[0] !== query[0]) return null;
  const firstWord = term.split(' ')[0];
  const limit = query.length >= 7 ? 2 : 1;
  const distance = boundedEditDistance(query, firstWord.slice(0, query.length + limit), limit);
  return distance <= limit ? 50 + distance + term.length / 100 : null;
}

/**
 * Builds search candidates from the already-rendered hierarchy. This keeps
 * autocomplete local to the current tree and avoids an additional data fetch.
 */
export function buildTaxonAutocompleteCandidates(root) {
  const candidates = [];
  const seen = new Set();
  const visitedNodes = new Set();
  if (!root) return candidates;

  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || visitedNodes.has(node)) continue;
    visitedNodes.add(node);

    const canonicalName = String(node.data?.name ?? '').trim();
    if (canonicalName) {
      const canonicalId = node.data?.id;

      const add = (term, isSynonym = false) => {
        const displayTerm = String(term ?? '').trim();
        const normalizedTerm = normalize(displayTerm);
        const key = `${canonicalId}|${normalizedTerm}`;
        if (!normalizedTerm || seen.has(key)) return;
        seen.add(key);
        candidates.push({ canonicalId, canonicalName, term: displayTerm, normalizedTerm, isSynonym });
      };

      add(canonicalName);
      (node.data?.synonymMetadata?.synonyms || []).forEach((synonym) => add(synonym.invalid_name, true));
    }

    // D3's hierarchy.each() skips _children. The visualizer stores collapsed
    // subtrees there, but they must still be discoverable from the search box.
    if (node.children) pending.push(...node.children);
    if (node._children) pending.push(...node._children);
  }

  return candidates;
}

/** Returns the strongest local name/synonym suggestions for a partial query. */
export function getTaxonAutocompleteSuggestions(candidates, query, limit = MAX_SUGGESTIONS) {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2) return [];

  const bestByTaxonId = new Map();
  candidates.forEach((candidate) => {
    const score = scoreTerm(normalizedQuery, candidate.normalizedTerm);
    if (score == null) return;
    const existing = bestByTaxonId.get(candidate.canonicalId);
    if (!existing || score < existing.score || (score === existing.score && candidate.isSynonym && !existing.isSynonym)) {
      bestByTaxonId.set(candidate.canonicalId, { ...candidate, score });
    }
  });

  return Array.from(bestByTaxonId.values())
    .sort((a, b) => a.score - b.score || a.canonicalName.localeCompare(b.canonicalName))
    .slice(0, limit);
}
