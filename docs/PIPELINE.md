# Ingestion Pipeline — Protocol, Dedup & Lifecycle

> Living document. Companion to PLAN.md. Last revised: 2026-06-28.

This is the contract for getting events from many platforms into one clean,
deduped, self-cleaning dataset.

## Stages

```
fetch ──▶ store raw ──▶ normalize ──▶ geocode ──▶ dedupe/merge ──▶ canonical events
                                                                        │
                                          lifecycle sweeper ◀───────────┘
```

Each run, per source:
1. **fetch** — `Source.fetch(ctx)` returns `RawEvent[]`.
2. **store raw** — upsert into `raw_events` on `(source, source_id)`. Bump
   `last_seen_at`, reset `missing_runs = 0`, compare `content_hash` to skip
   unchanged rows. Any previously-seen row from this source NOT in this fetch gets
   `missing_runs += 1` (staleness signal — see Lifecycle).
3. **normalize** — `Source.normalize(raw)` → `NormalizedEvent` (or dropped).
4. **geocode** — if no `lat/lng`, look up `geocode_cache` first; else hit Nominatim
   (1 req/sec, descriptive User-Agent), cache result (including negative hits).
5. **dedupe/merge** — attach the normalized event to a canonical `events` row.
6. **lifecycle** — separate scheduled pass retires events that are over or stale.

## The connector protocol

Every platform implements `Source` (see `worker/src/types.ts`):
- `key`, `name`, `kind` (`api | semi-api | scrape`), `trustRank`.
- `fetch(ctx)` → `RawEvent[]` — paging is the source's problem; the pipeline just
  gets a flat list.
- `normalize(raw)` → `NormalizedEvent | null` — pure function, easy to unit-test.

Adding a platform = one new file in `worker/src/sources/` + a row in `sources`.
No pipeline changes. Planned sources:

| key                 | kind     | trust | notes |
|---------------------|----------|-------|-------|
| `ticketmaster`      | api      | 10    | Discovery API, free key, clean coords/price |
| `seatgeek`          | api      | 20    | free client id |
| `eventbrite`        | api      | 30    | API access restricted; org-scoped |
| `luma`              | semi-api | 40    | lu.ma JSON endpoints, no official API |
| `scrape:funcheap`   | scrape   | 60    | high local volume, messy |
| `scrape:do415`      | scrape   | 60    | local |

`trustRank` lower = more authoritative. Used only to break ties during merge.

## Deduplication

The same real event shows up on multiple platforms with different titles, times,
and venue spellings. Goal: **one canonical `events` row per real event**, with
every contributing `raw_events` row pointing at it via `canonical_id`.

### Step 1 — re-match known rows (cheap, exact)
If a `raw_events` row already has a `canonical_id`, update that canonical in place.
This keeps ids stable across runs and avoids re-matching everything every time.

### Step 2 — blocking (avoid O(n²))
Compute a `dedupe_block` = `localStartDate` + `geoCell` (lat/lng rounded to ~3
decimals, ≈110m). Only events in the same block are ever compared. Same-day +
same-neighborhood is a hard prerequisite for "same event".

### Step 3 — pairwise scoring within a block
For a new normalized event vs each existing canonical in its block, score 0–1:

| signal              | how                                              | weight |
|---------------------|--------------------------------------------------|--------|
| title similarity    | `pg_trgm` similarity on `title_norm`             | 0.45   |
| start-time proximity| 1.0 if ≤30min apart, decaying to 0 by ~6h        | 0.30   |
| location proximity  | PostGIS `ST_DWithin`; 1.0 ≤75m, 0 by ~500m       | 0.20   |
| same source host    | normalized URL host equal                        | 0.05   |

`title_norm` = lowercased, emoji/punctuation stripped, collapsed whitespace,
stopwords like "the/at/presents" removed.

- **score ≥ 0.78** → same event → **merge** into that canonical.
- **0.55–0.78** → ambiguous → create canonical but `status='flagged'` for review.
- **< 0.55** → new canonical (`status='active'`).

Thresholds are constants in `pipeline/dedupe.ts`, tuned against real data and
covered by unit tests (the scoring is pure functions — TDD them).

### Step 4 — merge rule
When merging contributor → canonical, per field pick the value from the source
with the lowest `trustRank`; if tie, prefer the **richer** value (non-null,
longer description, has image, more precise coords). Always:
- keep the canonical `id` stable,
- point the contributor `raw_events.canonical_id` at it,
- set `primary_source` to the lowest-trustRank contributor,
- bump `updated_at`.

## Lifecycle — removing events after they're done

A scheduled **sweeper** (separate from ingest) keeps the dataset clean. Status
machine: `active → ended → removed` (with `flagged` and `stale` branches).

| transition           | rule |
|----------------------|------|
| `active → ended`     | now > `end_at` (or `start_at + 4h` default if no end). Set `ended_at_swept`. |
| `* → stale`          | every `raw_events` contributor has `missing_runs ≥ 3` (dropped from all sources) → likely cancelled/removed. |
| `ended/stale → removed` | grace period passed (≥7 days after it ended) → **copy to `events_archive`, then delete from `events`**; orphaned `raw_events` get `canonical_id = NULL` and are pruned after 30 days. |
| explicit cancel      | a source marks the event cancelled in its payload → straight to `removed`. |

Why soft-delete first: a flaky scrape or a source outage shouldn't nuke real
events. `ended` events stay queryable briefly (e.g. "what happened last weekend")
before archival. The map only ever serves `status='active'`.

Sweeper cadence: hourly is plenty. On Cloudflare it's a Cron Trigger.

## Serving

A read step exports `status='active'` events to a cacheable `events.json`
(and later a read API). The frontend consumes only that — it never sees raw,
flagged, or ended rows.

## Open questions / to tune

- Dedup thresholds (0.78 / 0.55) — calibrate on real multi-source overlap.
- Default event duration (4h) when a source omits `end_at`.
- Grace period before hard-delete (7d) and raw prune (30d).
