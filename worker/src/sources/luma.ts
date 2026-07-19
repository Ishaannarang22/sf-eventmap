import type { Source, RawEvent, NormalizedEvent } from '../types.ts';

// Luma (lu.ma) — no official public API, but city/discovery pages and event
// pages expose JSON (Next.js data / public endpoints). We read those.
// Approach: hit the SF discover feed, then each event's public json.
// TODO: confirm current endpoints (they change); honor robots/fair-use.
export const luma: Source = {
  key: 'luma',
  name: 'Luma',
  kind: 'semi-api',
  trustRank: 40,

  async fetch(_ctx): Promise<RawEvent[]> {
    // TODO: GET lu.ma SF discovery JSON, collect event slugs, fetch each event json.
    return [];
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.name || !ev?.start_at) return null;
    const geo = ev.geo_address_info ?? ev.location;
    return {
      title: ev.name,
      description: ev.description,
      category: 'other',
      startAt: ev.start_at,
      endAt: ev.end_at,
      tz: ev.timezone ?? 'America/Los_Angeles',
      venue: geo?.name ?? geo?.address,
      address: geo?.full_address ?? geo?.address,
      lat: geo?.latitude != null ? Number(geo.latitude) : undefined,
      lng: geo?.longitude != null ? Number(geo.longitude) : undefined,
      url: ev.url ? `https://lu.ma/${ev.url}` : undefined,
      image: ev.cover_url,
    };
  },
};
