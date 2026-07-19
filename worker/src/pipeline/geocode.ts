import { sql } from '../db/client.ts';

// Geocode an address via OSM Nominatim, cached in geocode_cache (incl. negative
// hits) so we respect fair-use (max ~1 req/sec) and stay free.
const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export interface GeoResult { lat: number; lng: number; }

let lastCall = 0;
async function rateLimit() {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function geocode(query: string, userAgent: string): Promise<GeoResult | null> {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const cached = await sql`SELECT lat, lng, hit FROM geocode_cache WHERE query = ${q}`;
  const row = cached[0];
  if (row) {
    return row.hit && row.lat != null ? { lat: row.lat, lng: row.lng } : null;
  }

  await rateLimit();
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'us');

  let result: GeoResult | null = null;
  let displayName: string | null = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
    if (res.ok) {
      const json: any = await res.json();
      if (json[0]) {
        result = { lat: Number(json[0].lat), lng: Number(json[0].lon) };
        displayName = json[0].display_name ?? null;
      }
    }
  } catch {
    /* network hiccup -> treat as miss, but don't cache the failure permanently */
    return null;
  }

  await sql`
    INSERT INTO geocode_cache (query, lat, lng, display_name, hit)
    VALUES (${q}, ${result?.lat ?? null}, ${result?.lng ?? null}, ${displayName}, ${result != null})
    ON CONFLICT (query) DO NOTHING`;

  return result;
}
