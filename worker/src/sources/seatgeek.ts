import type { Source, RawEvent, NormalizedEvent, Category } from '../types.ts';

// SeatGeek Platform API — free client id. https://platform.seatgeek.com/
// Geo query: /2/events?lat=&lon=&range=40mi, paged. Needs SEATGEEK_CLIENT_ID
// (SEATGEEK_CLIENT_SECRET optional). Skips gracefully when no id is configured.
const BASE = 'https://api.seatgeek.com/2/events';

/** Map SeatGeek event `type` + taxonomies onto our Category set. */
export function mapCategory(ev: any): Category {
  const type = String(ev?.type ?? '').toLowerCase();
  const taxos = (ev?.taxonomies ?? []).map((x: any) => String(x?.name ?? '').toLowerCase());
  const has = (s: string) => type.includes(s) || taxos.some((x: string) => x.includes(s));
  if (has('concert') || has('music')) return 'music';
  if (
    has('sports') || has('nba') || has('nfl') || has('mlb') || has('nhl') ||
    has('mls') || has('ncaa') || has('wnba') || has('soccer') || has('hockey') ||
    has('baseball') || has('basketball') || has('football') || has('tennis') || has('golf')
  ) return 'sports';
  if (
    has('theater') || has('broadway') || has('dance') || has('classical') ||
    has('opera') || has('ballet') || has('symphony') || has('art')
  ) return 'art';
  if (has('comedy')) return 'community';
  if (has('family') || has('children')) return 'family';
  return 'other';
}

export const seatgeek: Source = {
  key: 'seatgeek',
  name: 'SeatGeek',
  kind: 'api',
  trustRank: 20,

  async fetch(ctx): Promise<RawEvent[]> {
    const id = ctx.secrets.SEATGEEK_CLIENT_ID;
    if (!id) {
      console.log('[seatgeek] SEATGEEK_CLIENT_ID not set — skipping source.');
      return [];
    }
    const secret = ctx.secrets.SEATGEEK_CLIENT_SECRET;
    const [w, s, e, n] = ctx.region.bbox;
    const lat = (s + n) / 2;
    const lon = (w + e) / 2;
    const max = ctx.maxItems ?? 1000;
    const perPage = 100;
    const out: RawEvent[] = [];
    let page = 1;

    while (out.length < max) {
      const url = new URL(BASE);
      url.searchParams.set('client_id', id);
      if (secret) url.searchParams.set('client_secret', secret);
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lon));
      url.searchParams.set('range', '40mi');
      url.searchParams.set('per_page', String(perPage));
      url.searchParams.set('page', String(page));
      url.searchParams.set('sort', 'datetime_local.asc');

      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[seatgeek] HTTP ${res.status} on page ${page}`);
        break;
      }
      const json: any = await res.json();
      const events: any[] = json?.events ?? [];
      for (const ev of events) out.push({ sourceId: String(ev.id), url: ev.url, payload: ev });

      const total = json?.meta?.total ?? 0;
      if (events.length === 0 || page * perPage >= total) break;
      page++;
    }
    return out.slice(0, max);
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.title || !(ev?.datetime_utc || ev?.datetime_local)) return null;
    const v = ev.venue;
    const low = ev.stats?.lowest_price;
    return {
      title: ev.title,
      description: ev.description || undefined,
      category: mapCategory(ev),
      // datetime_utc is a naive-UTC string ("2026-07-01T03:00:00"); mark it as Z.
      startAt: ev.datetime_utc ? `${ev.datetime_utc}Z` : ev.datetime_local,
      tz: v?.timezone ?? 'America/Los_Angeles',
      venue: v?.name,
      address: [v?.address, v?.extended_address].filter(Boolean).join(', ') || undefined,
      lat: v?.location?.lat != null ? Number(v.location.lat) : undefined,
      lng: v?.location?.lon != null ? Number(v.location.lon) : undefined,
      url: ev.url,
      image: ev.performers?.find((p: any) => p?.image)?.image ?? undefined,
      price: low != null
        ? { min: Number(low), max: ev.stats?.highest_price != null ? Number(ev.stats.highest_price) : undefined, free: Number(low) === 0, currency: 'USD' }
        : undefined,
    };
  },
};
