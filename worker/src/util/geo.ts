// Geo helpers for dedup blocking + distance scoring. Pure functions.

/** Haversine distance in meters between two lng/lat points. */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const toRad = (d: number) => (d * Math.PI) / 180;

/** Coarse geo cell (~110m): lat/lng rounded to 3 decimals. */
export function geoCell(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/**
 * Blocking key: local start date + geo cell. Only events sharing a block are
 * ever compared during dedup. Events without coords block on date only.
 */
export function dedupeBlock(localDate: string, lat?: number, lng?: number): string {
  return lat != null && lng != null ? `${localDate}|${geoCell(lat, lng)}` : `${localDate}|nogeo`;
}
