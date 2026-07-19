// Lifecycle sweeper: retire events once they're over or have gone stale.
// Status machine: active -> ended -> removed, with a stale branch.
// Run on a schedule (Cloudflare Cron Trigger). See docs/PIPELINE.md.
// Env is loaded via the `--env-file=.env` flag in package.json scripts.
import { sql } from '../db/client.ts';

const DEFAULT_DURATION_HOURS = 4;   // assumed length when a source omits end_at
const STALE_MISSING_RUNS = 3;       // dropped from all sources this many runs -> stale
const GRACE_DAYS = 7;               // wait this long after ending before hard-delete
const RAW_PRUNE_DAYS = 30;          // prune orphaned raw rows after this

export async function sweep() {
  // 1. active -> ended: past end_at (or start_at + default duration).
  const ended = await sql`
    UPDATE events SET status = 'ended', ended_at_swept = now(), updated_at = now()
    WHERE status = 'active'
      AND now() > COALESCE(end_at, start_at + (${DEFAULT_DURATION_HOURS} || ' hours')::interval)
    RETURNING id`;

  // 2. * -> stale: every contributing raw row has gone missing for N runs.
  const stale = await sql`
    UPDATE events e SET status = 'stale', updated_at = now()
    WHERE e.status IN ('active', 'flagged')
      AND NOT EXISTS (
        SELECT 1 FROM raw_events r
        WHERE r.canonical_id = e.id AND r.missing_runs < ${STALE_MISSING_RUNS}
      )
      AND EXISTS (SELECT 1 FROM raw_events r WHERE r.canonical_id = e.id)
    RETURNING id`;

  // 3. ended/stale past grace -> archive then hard-delete.
  const removed = await sql`
    WITH doomed AS (
      SELECT id FROM events
      WHERE status IN ('ended', 'stale')
        AND COALESCE(ended_at_swept, updated_at) < now() - (${GRACE_DAYS} || ' days')::interval
    ), archived AS (
      INSERT INTO events_archive SELECT * FROM events WHERE id IN (SELECT id FROM doomed)
      RETURNING id
    )
    DELETE FROM events WHERE id IN (SELECT id FROM doomed) RETURNING id`;

  // 4. prune long-orphaned raw rows (their canonical was removed).
  const pruned = await sql`
    DELETE FROM raw_events
    WHERE canonical_id IS NULL
      AND last_seen_at < now() - (${RAW_PRUNE_DAYS} || ' days')::interval
    RETURNING id`;

  return {
    ended: ended.length,
    stale: stale.length,
    removed: removed.length,
    prunedRaw: pruned.length,
  };
}

// Allow `npm run sweep`.
if (import.meta.url === `file://${process.argv[1]}`) {
  sweep()
    .then((r) => { console.log('sweep:', r); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
