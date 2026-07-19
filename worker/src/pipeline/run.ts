// Ingest orchestrator: for every source, fetch -> store raw -> normalize ->
// geocode -> dedupe/upsert into canonical events. Env via --env-file=.env.
import { sql } from '../db/client.ts';
import { SOURCES, BAY_AREA } from '../sources/index.ts';
import type { Source, NormalizedEvent } from '../types.ts';
import { contentHash, hashId } from '../util/hash.ts';
import { dedupeBlock } from '../util/geo.ts';
import { normalizeTitle } from '../util/text.ts';
import { scoreMatch } from './dedupe.ts';
import { geocode } from './geocode.ts';

const USER_AGENT = process.env.NOMINATIM_USER_AGENT ?? 'sf-eventmap';

async function ensureSourceRow(s: Source) {
  await sql`
    INSERT INTO sources (key, name, kind, trust_rank)
    VALUES (${s.key}, ${s.name}, ${s.kind}, ${s.trustRank})
    ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, trust_rank = EXCLUDED.trust_rank`;
}

/** Local calendar date (Pacific) for blocking. */
function localDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

async function runSource(s: Source) {
  await ensureSourceRow(s);
  const seen = new Set<string>();
  let raws: Awaited<ReturnType<Source['fetch']>> = [];
  try {
    raws = await s.fetch({ region: BAY_AREA, maxItems: 1000, secrets: process.env });
  } catch (err) {
    console.error(`[${s.key}] fetch failed:`, err);
    await sql`UPDATE sources SET last_run_at = now(), last_ok = false WHERE key = ${s.key}`;
    return;
  }

  for (const raw of raws) {
    seen.add(raw.sourceId);
    const hash = contentHash(raw.payload);
    // Upsert raw, bump last_seen, reset missing_runs.
    await sql`
      INSERT INTO raw_events (source, source_id, payload, content_hash, url)
      VALUES (${s.key}, ${raw.sourceId}, ${JSON.stringify(raw.payload)}, ${hash}, ${raw.url ?? null})
      ON CONFLICT (source, source_id) DO UPDATE
        SET payload = EXCLUDED.payload, content_hash = EXCLUDED.content_hash,
            url = EXCLUDED.url, last_seen_at = now(), missing_runs = 0`;

    const norm = s.normalize(raw);
    if (!norm) continue;

    // Geocode if needed.
    if (norm.lat == null || norm.lng == null) {
      const q = [norm.venue, norm.address].filter(Boolean).join(', ');
      const geo = q ? await geocode(q, USER_AGENT) : null;
      if (geo) { norm.lat = geo.lat; norm.lng = geo.lng; }
    }

    await upsertCanonical(s, raw.sourceId, norm);
  }

  // Anything previously seen from this source but missing now -> bump staleness.
  await sql`
    UPDATE raw_events SET missing_runs = missing_runs + 1
    WHERE source = ${s.key} AND NOT (source_id = ANY(${[...seen]}))`;

  await sql`UPDATE sources SET last_run_at = now(), last_ok = true WHERE key = ${s.key}`;
  console.log(`[${s.key}] processed ${raws.length} raw events`);
}

async function upsertCanonical(s: Source, sourceId: string, norm: NormalizedEvent) {
  const block = dedupeBlock(localDate(norm.startAt, norm.tz), norm.lat, norm.lng);
  const titleNorm = normalizeTitle(norm.title);

  // If this raw row already maps to a canonical, update it in place (stable id).
  const existingLink = await sql`
    SELECT canonical_id FROM raw_events WHERE source = ${s.key} AND source_id = ${sourceId}`;
  let canonicalId: string | null = existingLink[0]?.canonical_id ?? null;
  let flagged = false;

  if (!canonicalId) {
    // Look for a match within the same block.
    const candidates = await sql`
      SELECT id, title, start_at, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng, url
      FROM events WHERE dedupe_block = ${block} AND status IN ('active','flagged')`;
    let best: { id: string; decision: string } | null = null;
    let bestTotal = 0;
    for (const c of candidates) {
      const score = scoreMatch(norm, {
        title: c.title, startAt: new Date(c.start_at).toISOString(),
        lat: c.lat ?? undefined, lng: c.lng ?? undefined, url: c.url ?? undefined,
        category: 'other', tz: norm.tz,
      });
      if (score.total > bestTotal && score.decision !== 'distinct') {
        bestTotal = score.total;
        best = { id: c.id as string, decision: score.decision };
      }
    }
    if (best?.decision === 'merge') canonicalId = best.id;
    // (flag-tier matches still create a new row but marked 'flagged' below)
    flagged = best?.decision === 'flag';
  }

  if (canonicalId) {
    // Merge: refresh fields (simple last-write; trust-rank merge is a TODO refinement).
    await sql`
      UPDATE events SET
        description = COALESCE(${norm.description ?? null}, description),
        image = COALESCE(${norm.image ?? null}, image),
        updated_at = now()
      WHERE id = ${canonicalId}`;
  } else {
    canonicalId = hashId(s.key, sourceId, norm.startAt);
    await sql`
      INSERT INTO events (
        id, title, title_norm, description, category, start_at, end_at, tz,
        venue, address, geo, price_min, price_max, is_free, currency, url, image,
        primary_source, dedupe_block, status)
      VALUES (
        ${canonicalId}, ${norm.title}, ${titleNorm}, ${norm.description ?? null},
        ${norm.category}, ${norm.startAt}, ${norm.endAt ?? null}, ${norm.tz},
        ${norm.venue ?? null}, ${norm.address ?? null},
        ST_SetSRID(ST_MakePoint(${norm.lng ?? null}, ${norm.lat ?? null}), 4326)::geography,
        ${norm.price?.min ?? null}, ${norm.price?.max ?? null}, ${norm.price?.free ?? null},
        ${norm.price?.currency ?? 'USD'}, ${norm.url ?? null}, ${norm.image ?? null},
        ${s.key}, ${block}, ${flagged ? 'flagged' : 'active'})
      ON CONFLICT (id) DO NOTHING`;
  }

  await sql`
    UPDATE raw_events SET canonical_id = ${canonicalId}
    WHERE source = ${s.key} AND source_id = ${sourceId}`;
}

async function main() {
  for (const s of SOURCES) await runSource(s);
  console.log('ingest complete');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
