import type { Source, RawEvent, NormalizedEvent, Category } from '../types.ts';

// Ticketmaster Discovery API — free key, clean structured data with coords + price.
// Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
const BASE = 'https://app.ticketmaster.com/discovery/v2/events.json';

function mapCategory(segment?: string): Category {
  switch ((segment ?? '').toLowerCase()) {
    case 'music': return 'music';
    case 'sports': return 'sports';
    case 'arts & theatre': return 'art';
    case 'film': return 'art';
    default: return 'other';
  }
}

export const ticketmaster: Source = {
  key: 'ticketmaster',
  name: 'Ticketmaster',
  kind: 'api',
  trustRank: 10,

  async fetch(ctx): Promise<RawEvent[]> {
    const key = ctx.secrets.TICKETMASTER_API_KEY;
    if (!key) return []; // disabled until a key is provided
    const [w, s, e, n] = ctx.region.bbox;
    const out: RawEvent[] = [];
    const size = 200;
    let page = 0;
    while (out.length < (ctx.maxItems ?? 1000)) {
      const url = new URL(BASE);
      url.searchParams.set('apikey', key);
      url.searchParams.set('geoPoint', ''); // (optional) could use geohash
      url.searchParams.set('latlong', `${(s + n) / 2},${(w + e) / 2}`);
      url.searchParams.set('radius', '40');
      url.searchParams.set('unit', 'miles');
      url.searchParams.set('size', String(size));
      url.searchParams.set('page', String(page));
      const res = await fetch(url);
      if (!res.ok) break;
      const json: any = await res.json();
      const events = json?._embedded?.events ?? [];
      for (const ev of events) out.push({ sourceId: ev.id, url: ev.url, payload: ev });
      const totalPages = json?.page?.totalPages ?? 1;
      if (++page >= totalPages || events.length === 0) break;
    }
    return out;
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.name || !ev?.dates?.start?.dateTime) return null;
    const venue = ev._embedded?.venues?.[0];
    const price = ev.priceRanges?.[0];
    return {
      title: ev.name,
      description: ev.info ?? ev.pleaseNote,
      category: mapCategory(ev.classifications?.[0]?.segment?.name),
      startAt: ev.dates.start.dateTime,
      tz: ev.dates.timezone ?? 'America/Los_Angeles',
      venue: venue?.name,
      address: [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode]
        .filter(Boolean)
        .join(', '),
      lat: venue?.location ? Number(venue.location.latitude) : undefined,
      lng: venue?.location ? Number(venue.location.longitude) : undefined,
      price: price
        ? { min: price.min, max: price.max, free: price.min === 0, currency: price.currency ?? 'USD' }
        : undefined,
      url: ev.url,
      image: ev.images?.find((i: any) => i.width >= 640)?.url ?? ev.images?.[0]?.url,
    };
  },
};
