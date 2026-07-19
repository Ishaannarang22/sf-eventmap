// Pure text helpers used by dedup. No I/O — easy to unit-test (TDD these).

const STOPWORDS = new Set([
  'the', 'a', 'an', 'at', 'in', 'on', 'of', 'and', '&', 'with', 'feat',
  'featuring', 'presents', 'presented', 'by', 'live', 'show', 'event',
]);

/** Lowercase, strip emoji/punctuation, drop stopwords, collapse whitespace. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')        // accents
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')       // keep letters/numbers/space
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

/** Trigram Jaccard similarity in [0,1] — a JS mirror of pg_trgm for tests/fallback. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}
