import * as cheerio from 'cheerio';
import type { Source, RawEvent, NormalizedEvent } from '../types.ts';

// Luma (lu.ma) — no official public API. City discovery pages are Next.js apps
// that embed their data in a <script id="__NEXT_DATA__"> JSON blob. We fetch those
// pages and pull event objects out of the embedded state. No key required; we rate
// limit and send a descriptive User-Agent to stay a good citizen.
const CITY_SLUGS = ['sf', 'oakland', 'berkeley', 'san-jose', 'san-francisco'];
const UA = process.env.SCRAPER_USER_AGENT
  ?? process.env.NOMINATIM_USER_AGENT
  ?? 'sf-eventmap (https://github.com/Ishaannarang22/sf-eventmap)';
const DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True if this object looks like a Luma event payload. */
function isLumaEvent(o: any): boolean {
  return !!o && typeof o === 'object' && typeof o.name === 'string' && typeof o.start_at === 'string';
}

/** Recursively collect Luma event objects out of arbitrary embedded JSON. */
function collectEvents(node: any, out: Map<string, any>, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) collectEvents(item, out, depth + 1);
    return;
  }
  // Common wrapper shape: { api_id, event: { ...actual event... } }.
  if (node.event && isLumaEvent(node.event)) {
    const ev = node.event;
    out.set(String(ev.api_id ?? node.api_id ?? ev.url ?? ev.name), ev);
  }
  if (isLumaEvent(node)) {
    out.set(String(node.api_id ?? node.url ?? node.name), node);
  }
  for (const key of Object.keys(node)) collectEvents(node[key], out, depth + 1);
}

/** Parse one Luma city page's HTML into RawEvents. Pure — unit-tested with fixtures. */
export function parseLumaNextData(html: string): RawEvent[] {
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').first().text();
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const found = new Map<string, any>();
  collectEvents(data, found);
  return [...found.values()].map((ev) => ({
    sourceId: String(ev.api_id ?? ev.url ?? ev.name),
    url: ev.url ? `https://lu.ma/${ev.url}` : undefined,
    payload: ev,
  }));
}

export const luma: Source = {
  key: 'luma',
  name: 'Luma',
  kind: 'semi-api',
  trustRank: 40,

  async fetch(ctx): Promise<RawEvent[]> {
    const max = ctx.maxItems ?? 1000;
    const out: RawEvent[] = [];
    const seen = new Set<string>();
    for (const slug of CITY_SLUGS) {
      if (out.length >= max) break;
      await sleep(DELAY_MS); // respectful rate limiting between page loads
      try {
        const res = await fetch(`https://lu.ma/${slug}`, { headers: { 'User-Agent': UA } });
        if (!res.ok) {
          console.error(`[luma] ${slug} HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        for (const r of parseLumaNextData(html)) {
          if (!seen.has(r.sourceId)) { seen.add(r.sourceId); out.push(r); }
        }
      } catch (err) {
        console.error(`[luma] ${slug} failed:`, err);
      }
    }
    console.log(`[luma] collected ${out.length} events across ${CITY_SLUGS.length} pages`);
    return out.slice(0, max);
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.name || !ev?.start_at) return null;
    const geo = ev.geo_address_info ?? ev.location ?? {};
    return {
      title: ev.name,
      description: ev.description || ev.description_short || undefined,
      category: 'other',
      startAt: ev.start_at,
      endAt: ev.end_at || undefined,
      tz: ev.timezone ?? 'America/Los_Angeles',
      venue: geo?.name ?? geo?.address ?? undefined,
      address: geo?.full_address ?? geo?.address ?? undefined,
      lat: geo?.latitude != null ? Number(geo.latitude) : undefined,
      lng: geo?.longitude != null ? Number(geo.longitude) : undefined,
      url: raw.url ?? (ev.url ? `https://lu.ma/${ev.url}` : undefined),
      image: ev.cover_url || undefined,
    };
  },
};
