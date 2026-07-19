// Time helpers for scrape sources that only expose a local wall-clock time.
// Pure functions — unit-tested, no I/O.

/** Minutes a timezone is ahead of UTC at a given absolute instant. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(map.year), Number(map.month) - 1, Number(map.day),
    Number(map.hour === '24' ? '0' : map.hour), Number(map.minute), Number(map.second),
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/**
 * Convert a wall-clock time in `tz` to an absolute ISO 8601 instant (UTC `Z`).
 * Handles DST by resolving the offset at the computed instant. Used by scrapers
 * (Funcheap) that only give a local date + "7:00 pm" style time.
 */
export function wallClockToISO(
  tz: string,
  y: number, mo: number, d: number, h: number, mi: number,
): string {
  // Treat the wall clock as if it were UTC, then correct by the real offset.
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  // Refine twice so DST-boundary instants converge.
  let off = tzOffsetMinutes(tz, new Date(guess));
  off = tzOffsetMinutes(tz, new Date(guess - off * 60_000));
  return new Date(guess - off * 60_000).toISOString();
}

/**
 * Parse a free-text time like "7:00 PM", "7pm", "12 noon", "8:30p" into
 * { h, mi } on a 24h clock. Returns null if nothing time-like is found.
 */
export function parseClockTime(text: string): { h: number; mi: number } | null {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return { h: 12, mi: 0 };
  if (/\bmidnight\b/.test(t)) return { h: 0, mi: 0 };
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a|p)\.?m?\.?\b/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = m[2] ? Number(m[2]) : 0;
  const pm = m[3] === 'p';
  if (h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  if (h > 23 || mi > 59) return null;
  return { h, mi };
}
