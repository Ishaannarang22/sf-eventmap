import * as cheerio from 'cheerio';
import type { Source, RawEvent, NormalizedEvent } from '../types.ts';
import { wallClockToISO, parseClockTime } from '../util/time.ts';

// Funcheap SF — pure HTML scrape of the daily archive pages
// (https://sf.funcheap.com/YYYY/MM/DD/). High volume of small/free local events,
// which is exactly the "every local event" goal. Data is messy: times are
// free-text and coords are absent (the geocoder fills them from venue/address).
// No key required; we rate limit and send a descriptive User-Agent.
const TZ = 'America/Los_Angeles';
const HORIZON_DAYS = 10; // how many days ahead to scrape each run
const DELAY_MS = 1500;
const UA = process.env.SCRAPER_USER_AGENT
  ?? process.env.NOMINATIM_USER_AGENT
  ?? 'sf-eventmap (https://github.com/Ishaannarang22/sf-eventmap)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pacific calendar date (YYYY-MM-DD) `offset` days from now. */
function pacificDate(offsetDays: number): string {
  // Anchor at UTC noon so ±day arithmetic never lands on a DST edge.
  const anchor = new Date();
  anchor.setUTCHours(12, 0, 0, 0);
  const d = new Date(anchor.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Parse one Funcheap day-archive page into RawEvents for the given date.
 * Pure function (no I/O) so it can be unit-tested against saved fixtures.
 * Selectors are defensive: Funcheap's WordPress markup varies by page.
 */
export function parseFuncheapListing(html: string, dateISO: string): RawEvent[] {
  const $ = cheerio.load(html);
  const [y, mo, d] = dateISO.split('-').map(Number) as [number, number, number];

  const blocks = $('.tanbox, .archive-event, article, .event-details').toArray();
  const out: RawEvent[] = [];
  const seen = new Set<string>();

  for (const el of blocks) {
    const $el = $(el);
    const $a = $el.find('.title a, h2 a, h3 a, a.event-title, a[rel="bookmark"]').first();
    const href = $a.attr('href');
    const title = $a.text().trim();
    if (!href || !title) continue;
    if (!/^https?:\/\/(?:\w+\.)?funcheap\.com/i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    const text = $el.text().replace(/\s+/g, ' ').trim();
    const time = parseClockTime(text);
    const startAt = wallClockToISO(TZ, y, mo, d, time?.h ?? 12, time?.mi ?? 0);
    const free = /\bfree\b/i.test(text) && !/\bnot free\b/i.test(text);
    const img = $el.find('img').first().attr('src') || undefined;
    // Venue is often absent from the listing; leave it to the geocoder when we
    // can find something location-like, otherwise omit. (We deliberately avoid
    // generic ".meta" blocks — on Funcheap those hold the time/cost line.)
    const venue = $el.find('.venue, .location, .event-venue').first().text().trim() || undefined;

    out.push({
      sourceId: href,
      url: href,
      payload: {
        title,
        startAt,
        venue,
        image: img,
        free,
        category: 'community',
      },
    });
  }
  return out;
}

export const funcheap: Source = {
  key: 'scrape:funcheap',
  name: 'Funcheap SF',
  kind: 'scrape',
  trustRank: 60,

  async fetch(ctx): Promise<RawEvent[]> {
    const max = ctx.maxItems ?? 1000;
    const out: RawEvent[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < HORIZON_DAYS; i++) {
      if (out.length >= max) break;
      const dateISO = pacificDate(i);
      const [y, mo, d] = dateISO.split('-');
      const url = `https://sf.funcheap.com/${y}/${mo}/${d}/`;
      await sleep(DELAY_MS); // respectful rate limiting between page loads
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) {
          console.error(`[funcheap] ${dateISO} HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        for (const r of parseFuncheapListing(html, dateISO)) {
          if (!seen.has(r.sourceId)) { seen.add(r.sourceId); out.push(r); }
        }
      } catch (err) {
        console.error(`[funcheap] ${dateISO} failed:`, err);
      }
    }
    console.log(`[funcheap] collected ${out.length} events over ${HORIZON_DAYS} days`);
    return out.slice(0, max);
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.title || !ev?.startAt) return null;
    return {
      title: ev.title,
      description: ev.description || undefined,
      category: ev.category ?? 'community',
      startAt: ev.startAt,
      tz: TZ,
      venue: ev.venue || undefined,
      address: ev.address || undefined,
      // no coords from Funcheap — geocoder resolves venue/address downstream
      url: raw.url,
      image: ev.image || undefined,
      price: ev.free ? { min: 0, free: true, currency: 'USD' } : undefined,
    };
  },
};
