import type { NormalizedEvent } from '../types.ts';
import { normalizeTitle, trigramSimilarity } from '../util/text.ts';
import { distanceMeters } from '../util/geo.ts';

// Pure dedup scoring. Given two events, how likely are they the SAME real event?
// Thresholds and weights live here so they're easy to tune + unit-test.

export const WEIGHTS = { title: 0.45, time: 0.30, location: 0.20, host: 0.05 };
export const MERGE_THRESHOLD = 0.78;   // >= -> same event, merge
export const FLAG_THRESHOLD = 0.55;    // in [FLAG, MERGE) -> create but flag for review

export interface MatchScore {
  total: number;
  title: number;
  time: number;
  location: number;
  host: number;
  decision: 'merge' | 'flag' | 'distinct';
}

/** Time score: 1.0 within 30min, linearly decaying to 0 by 6h apart. */
function timeScore(aIso: string, bIso: string): number {
  const diffMin = Math.abs(Date.parse(aIso) - Date.parse(bIso)) / 60_000;
  if (diffMin <= 30) return 1;
  if (diffMin >= 360) return 0;
  return 1 - (diffMin - 30) / (360 - 30);
}

/** Location score: 1.0 within 75m, decaying to 0 by 500m. No coords -> neutral 0. */
function locationScore(a: NormalizedEvent, b: NormalizedEvent): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
  const d = distanceMeters({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  if (d <= 75) return 1;
  if (d >= 500) return 0;
  return 1 - (d - 75) / (500 - 75);
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return undefined; }
}

export function scoreMatch(a: NormalizedEvent, b: NormalizedEvent): MatchScore {
  const title = trigramSimilarity(normalizeTitle(a.title), normalizeTitle(b.title));
  const time = timeScore(a.startAt, b.startAt);
  const location = locationScore(a, b);
  const ha = hostOf(a.url);
  const hb = hostOf(b.url);
  const host = ha && hb && ha === hb ? 1 : 0;

  const total =
    title * WEIGHTS.title +
    time * WEIGHTS.time +
    location * WEIGHTS.location +
    host * WEIGHTS.host;

  const decision =
    total >= MERGE_THRESHOLD ? 'merge' : total >= FLAG_THRESHOLD ? 'flag' : 'distinct';

  return { total, title, time, location, host, decision };
}
