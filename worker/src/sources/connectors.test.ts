import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { seatgeek, mapCategory as sgCategory } from './seatgeek.ts';
import { eventbrite, mapCategory as ebCategory } from './eventbrite.ts';
import { luma, parseLumaNextData } from './luma.ts';
import { funcheap, parseFuncheapListing } from './funcheap.ts';
import { wallClockToISO, parseClockTime } from '../util/time.ts';
import type { RawEvent } from '../types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, '__fixtures__', name), 'utf8');
const json = (name: string) => JSON.parse(fixture(name));

describe('util/time', () => {
  it('converts a summer (PDT, -07:00) wall clock to UTC', () => {
    expect(wallClockToISO('America/Los_Angeles', 2026, 7, 1, 20, 0)).toBe('2026-07-02T03:00:00.000Z');
  });
  it('converts a winter (PST, -08:00) wall clock to UTC', () => {
    expect(wallClockToISO('America/Los_Angeles', 2026, 1, 1, 20, 0)).toBe('2026-01-02T04:00:00.000Z');
  });
  it('parses free-text clock times', () => {
    expect(parseClockTime('Doors 7:00 PM')).toEqual({ h: 19, mi: 0 });
    expect(parseClockTime('starts at 9am')).toEqual({ h: 9, mi: 0 });
    expect(parseClockTime('12 noon in the park')).toEqual({ h: 12, mi: 0 });
    expect(parseClockTime('12:30am late show')).toEqual({ h: 0, mi: 30 });
    expect(parseClockTime('no time here')).toBeNull();
  });
});

describe('seatgeek', () => {
  it('maps categories from type/taxonomies', () => {
    expect(sgCategory({ type: 'concert' })).toBe('music');
    expect(sgCategory({ type: 'nba' })).toBe('sports');
    expect(sgCategory({ type: 'theater' })).toBe('art');
    expect(sgCategory({ type: 'comedy' })).toBe('community');
    expect(sgCategory({ type: 'mystery' })).toBe('other');
  });

  it('normalizes a real event payload', () => {
    const raw: RawEvent = { sourceId: '5948190', payload: json('seatgeek_event.json') };
    const n = seatgeek.normalize(raw)!;
    expect(n.title).toBe('Tycho');
    expect(n.category).toBe('music');
    expect(n.startAt).toBe('2026-07-01T03:00:00Z'); // naive-UTC gets a Z appended
    expect(n.lat).toBeCloseTo(37.7842);
    expect(n.lng).toBeCloseTo(-122.4329);
    expect(n.venue).toBe('The Fillmore');
    expect(n.price).toEqual({ min: 45, max: 120, free: false, currency: 'USD' });
  });

  it('drops payloads missing required fields', () => {
    expect(seatgeek.normalize({ sourceId: 'x', payload: { title: 'No date' } })).toBeNull();
  });

  it('fetch() skips gracefully with no client id', async () => {
    const out = await seatgeek.fetch({ region: { name: 'x', bbox: [0, 0, 0, 0] }, secrets: {} });
    expect(out).toEqual([]);
  });
});

describe('eventbrite', () => {
  it('maps category ids', () => {
    expect(ebCategory('103')).toBe('music');
    expect(ebCategory('102')).toBe('tech');
    expect(ebCategory('108')).toBe('sports');
    expect(ebCategory('999')).toBe('other');
  });

  it('normalizes a real event payload with cents->dollars pricing', () => {
    const raw: RawEvent = { sourceId: '1234567890', payload: json('eventbrite_event.json') };
    const n = eventbrite.normalize(raw)!;
    expect(n.title).toBe('SF Tech Meetup');
    expect(n.category).toBe('tech');
    expect(n.startAt).toBe('2026-07-15T01:00:00Z');
    expect(n.endAt).toBe('2026-07-15T04:00:00Z');
    expect(n.lat).toBeCloseTo(37.7936);
    expect(n.price).toEqual({ min: 15, max: 30, free: false, currency: 'USD' });
  });

  it('fetch() skips gracefully with no token', async () => {
    const out = await eventbrite.fetch({ region: { name: 'x', bbox: [0, 0, 0, 0] }, secrets: {} });
    expect(out).toEqual([]);
  });
});

describe('luma', () => {
  it('extracts events from an embedded __NEXT_DATA__ blob', () => {
    const raws = parseLumaNextData(fixture('luma_page.html'));
    expect(raws).toHaveLength(2);
    const abc = raws.find((r) => r.sourceId === 'evt-abc')!;
    expect(abc.url).toBe('https://lu.ma/ai-builders-sf');
    const n = luma.normalize(abc)!;
    expect(n.title).toBe('AI Builders Night');
    expect(n.startAt).toBe('2026-07-20T01:00:00.000Z');
    expect(n.venue).toBe('GitHub HQ');
    expect(n.lat).toBeCloseTo(37.7823);
    expect(n.url).toBe('https://lu.ma/ai-builders-sf');
  });

  it('returns nothing when no __NEXT_DATA__ is present', () => {
    expect(parseLumaNextData('<html><body>nope</body></html>')).toEqual([]);
  });
});

describe('funcheap', () => {
  it('parses a day-archive page, keeping only funcheap links', () => {
    const raws = parseFuncheapListing(fixture('funcheap_day.html'), '2026-07-15');
    expect(raws).toHaveLength(2); // the off-site sponsored ad is filtered out

    const yoga = raws[0]!;
    expect((yoga.payload as any).title).toBe('Free Morning Yoga at Dolores Park');
    expect((yoga.payload as any).free).toBe(true);
    // 10:00 am Pacific on 2026-07-15 (PDT, -07:00) -> 17:00 UTC
    expect((yoga.payload as any).startAt).toBe('2026-07-15T17:00:00.000Z');

    const n = funcheap.normalize(yoga)!;
    expect(n.category).toBe('community');
    expect(n.price).toEqual({ min: 0, free: true, currency: 'USD' });
    expect(n.url).toBe('https://sf.funcheap.com/free-yoga-dolores-park/');

    const market = raws[1]!;
    expect((market.payload as any).free).toBe(false);
    expect(funcheap.normalize(market)!.price).toBeUndefined();
  });
});
