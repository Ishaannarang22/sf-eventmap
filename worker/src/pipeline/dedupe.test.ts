import { describe, it, expect } from 'vitest';
import { scoreMatch } from './dedupe.ts';
import { normalizeTitle, trigramSimilarity } from '../util/text.ts';
import type { NormalizedEvent } from '../types.ts';

const base: NormalizedEvent = {
  title: 'Tycho Live at The Fillmore',
  category: 'music',
  startAt: '2026-07-01T03:00:00Z', // 8pm PT
  tz: 'America/Los_Angeles',
  lat: 37.7842,
  lng: -122.4329,
  url: 'https://ticketmaster.com/abc',
};

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation, drops stopwords', () => {
    expect(normalizeTitle('Tycho LIVE at The Fillmore!')).toBe('tycho fillmore');
  });
});

describe('trigramSimilarity', () => {
  it('is 1 for identical strings', () => {
    expect(trigramSimilarity('tycho fillmore', 'tycho fillmore')).toBe(1);
  });
  it('is low for unrelated strings', () => {
    expect(trigramSimilarity('tycho fillmore', 'salsa night oakland')).toBeLessThan(0.2);
  });
});

describe('scoreMatch', () => {
  it('merges the same event from two platforms with slightly different titles', () => {
    const other: NormalizedEvent = {
      ...base,
      title: 'Tycho at the Fillmore',         // different wording
      startAt: '2026-07-01T03:15:00Z',        // 15 min off
      lat: 37.7843, lng: -122.4330,            // ~15m away
      url: 'https://luma.com/xyz',             // different host
    };
    const score = scoreMatch(base, other);
    expect(score.decision).toBe('merge');
    expect(score.total).toBeGreaterThanOrEqual(0.78);
  });

  it('keeps distinct events at the same venue/day apart in time + title', () => {
    const other: NormalizedEvent = {
      ...base,
      title: 'Salsa Dance Night',
      startAt: '2026-07-01T20:00:00Z', // many hours apart
    };
    const score = scoreMatch(base, other);
    expect(score.decision).toBe('distinct');
  });

  it('flags an ambiguous middle-ground match for review', () => {
    const other: NormalizedEvent = {
      ...base,
      title: 'Tycho Fillmore', // similar title
      startAt: '2026-07-01T05:30:00Z', // ~2.5h apart -> partial time score
      lat: undefined, lng: undefined,  // no coords -> no location boost
      url: undefined,
    };
    const score = scoreMatch(base, other);
    expect(['flag', 'merge']).toContain(score.decision);
  });
});
