/** Parse search input while preserving commas inside quoted taxon names. */

export function splitSearchQuery(value) {
  const input = String(value ?? '');
  const parts = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      current += char;
      continue;
    }
    if (char === ',' && !quote) {
      const part = current.trim();
      if (part) parts.push(part);
      current = '';
      continue;
    }
    current += char;
  }

  const part = current.trim();
  if (part) parts.push(part);
  return parts;
}

export function unwrapQuotedSearchTerm(value) {
  const term = String(value ?? '').trim();
  if (term.length < 2) return term;
  const quote = term[0];
  if ((quote !== '"' && quote !== "'") || term.at(-1) !== quote) return term;
  return term
    .slice(1, -1)
    .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
    .replace(/\\\\\\\\/g, '\\');
}

