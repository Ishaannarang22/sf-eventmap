// Export step: read the canonical `events` table and write the frontend-consumable
// `events.json` artifact. The map only ever sees status='active' rows — never raw,
// flagged, ended, or removed events (see docs/PIPELINE.md "Serving").
//
// Output path: EVENTS_JSON_PATH env, else <repo>/data/events.json.
// Env (DATABASE_URL) is loaded via `--env-file-if-exists=.env` in package.json.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../db/client.ts';

const here = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(here, '..', '..');       // .../worker
const defaultOut = resolve(workerRoot, '..', 'data', 'events.json');

/** The shape the frontend map consumes (mirrors the Event type in docs/PLAN.md). */
export interface ExportedEvent {
  id: string;
  title: string;
  description?: string;
  category: string;
  start: string;
  end?: string;
  tz: string;
  venue?: string;
  address?: string;
  lat?: number;
  lng?: number;
  price?: { min: number; max?: number; free: boolean; currency: string };
  url?: string;
  image?: string;
  source: string;      // primary (most-trusted) contributing source
  sources: string[];   // every source that reported this event
  updatedAt: string;
}

function toExported(r: any): ExportedEvent {
  const hasPrice = r.price_min != null || r.is_free != null;
  return {
    id: r.id,
    title: r.title,
    description: r.description ?? undefined,
    category: r.category,
    start: new Date(r.start_at).toISOString(),
    end: r.end_at ? new Date(r.end_at).toISOString() : undefined,
    tz: r.tz,
    venue: r.venue ?? undefined,
    address: r.address ?? undefined,
    lat: r.lat != null ? Number(r.lat) : undefined,
    lng: r.lng != null ? Number(r.lng) : undefined,
    price: hasPrice
      ? {
          min: r.price_min != null ? Number(r.price_min) : 0,
          max: r.price_max != null ? Number(r.price_max) : undefined,
          free: r.is_free ?? (r.price_min != null ? Number(r.price_min) === 0 : false),
          currency: r.currency ?? 'USD',
        }
      : undefined,
    url: r.url ?? undefined,
    image: r.image ?? undefined,
    source: r.primary_source ?? (Array.isArray(r.sources) ? r.sources[0] : undefined) ?? 'unknown',
    sources: Array.isArray(r.sources) ? r.sources : [],
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export async function exportEvents(outPath: string = process.env.EVENTS_JSON_PATH
  ? resolve(process.cwd(), process.env.EVENTS_JSON_PATH)
  : defaultOut): Promise<{ path: string; count: number }> {
  const rows = await sql`
    SELECT
      e.id, e.title, e.description, e.category, e.start_at, e.end_at, e.tz,
      e.venue, e.address,
      ST_Y(e.geo::geometry) AS lat, ST_X(e.geo::geometry) AS lng,
      e.price_min, e.price_max, e.is_free, e.currency, e.url, e.image,
      e.primary_source, e.updated_at,
      ARRAY(
        SELECT DISTINCT r.source FROM raw_events r WHERE r.canonical_id = e.id
      ) AS sources
    FROM events e
    WHERE e.status = 'active'
    ORDER BY e.start_at ASC`;

  const events = rows.map(toExported);
  const payload = {
    generatedAt: new Date().toISOString(),
    count: events.length,
    events,
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { path: outPath, count: events.length };
}

// Allow `npm run export`.
if (import.meta.url === `file://${process.argv[1]}`) {
  exportEvents()
    .then((r) => { console.log(`exported ${r.count} active events -> ${r.path}`); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
