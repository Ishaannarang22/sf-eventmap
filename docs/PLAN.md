# SF / Bay Area Event Map — Plan

> Living document. Update as decisions are made. Last revised: 2026-06-28.

## Vision

A map of (ideally) **every** local event in the Bay Area, pinned by location, with
rich filtering (category, date, price, search). Map rendered with **MapLibre GL** on
free OpenStreetMap-based tiles, styled to look good.

## Guiding principle: pipeline before delivery

The map is the easy part. The hard, valuable part is the **data pipeline** — sourcing
events from many places, normalizing them into one shape, **deduplicating** the
inevitable overlap, **geocoding** to coordinates, and **curating** quality. We build
and harden that pipeline FIRST. The frontend is just a consumer of a clean dataset.

```
  SOURCES                  PIPELINE                         OUTPUT
  ┌───────────┐
  │ APIs      │──┐
  │ scrapers  │──┤   ingest → normalize → dedupe →    ┌─→ DB (canonical store)
  │ user subs │──┘   geocode → curate/score           └─→ events.json (served to map)
  └───────────┘
```

## Build order (revised — pipeline first)

| Phase | Focus | Outcome | Status |
|---|---|---|---|
| **0** | Worker package scaffold, DB schema, migration runner | Pipeline skeleton runs | ✅ scaffolded |
| **1** | `Event` protocol + connectors (TM, SeatGeek, EB, Luma, Funcheap) | Sources pluggable | ✅ all connectors implemented |
| **2** | Geocoding (Nominatim + cache) | Every event has lat/lng | ✅ built |
| **3** | **Deduplication engine** (scoring + blocking + merge) | One event = one row | ✅ scoring done + tested |
| **3b** | **Lifecycle sweeper** (retire/remove ended + stale events) | Self-cleaning dataset | ✅ built |
| **C** | Connect Neon, run migration, first real ingest | Real rows landing | ⬅ next (owner supplies DATABASE_URL) |
| **4** | Fill in connector `fetch()` bodies for all sources | Broad coverage | ✅ done (all sources; API keys env-gated, scrapers keyless) |
| **5** | Curation / quality scoring tuning + review queue | Trustworthy dataset | todo |
| **6** | Export `events.json` / read API | Data ready to serve | ✅ export built (`npm run export` → `data/events.json`) |
| **7** | Frontend: Vite+React+TS + MapLibre, markers, clustering, filters | The map | todo |
| **8** | Aesthetic pass + user submissions | Polished + community | todo |
| **9** | Cloudflare deploy: Workers + Cron + Hyperdrive | Live + self-updating | ⏳ GitHub Actions daily cron done; Cloudflare scaffolded (`worker/wrangler.toml.example`) |

Phases 0–6 are the focus. Frontend (7+) waits until the dataset is solid.

## Normalized Event schema

Every source maps into this single shape:

```ts
type Event = {
  id: string;            // stable content hash — also the dedupe key
  title: string;
  description?: string;
  category: Category;    // music | food | art | tech | sports | community | nightlife | family | other
  start: string;         // ISO 8601
  end?: string;
  tz: string;            // 'America/Los_Angeles'
  venue?: string;
  address?: string;
  lat?: number;          // filled by geocoder if source lacks it
  lng?: number;
  price?: { min: number; max?: number; free: boolean; currency: string };
  url?: string;          // source / ticket link
  image?: string;
  source: string;        // 'ticketmaster' | 'eventbrite' | 'scrape:funcheap' | 'user' | ...
  sourceId?: string;     // id within that source, for re-fetch/update
  ingestedAt: string;
  updatedAt: string;
  status: 'active' | 'flagged' | 'removed';
};
```

Raw payloads from each source are also stored verbatim (a `raw_events` table) so we can
re-normalize without re-fetching.

## Pipeline stages

1. **Ingest** — each source is a connector with a uniform interface
   `fetch(): Promise<RawEvent[]>`. Writes raw payloads + a normalized draft.
2. **Normalize** — map source-specific fields → `Event`. Category mapping per source.
3. **Geocode** — if no coords, geocode `venue`/`address` via Nominatim; cache results
   by address to respect rate limits.
4. **Dedupe** — the core. Same real-world event seen by N sources → 1 canonical row.
   - Blocking key: rounded (date + geo cell) to limit comparisons.
   - Similarity: fuzzy title match + time proximity + venue/location proximity.
   - Merge: keep richest fields, retain all `source` links on the canonical record.
5. **Curate / score** — quality signals: has image? has coords? known venue? spammy
   title? Score → `status`. Low-quality or suspicious → `flagged` for review.
6. **Serve** — export a static `events.json` (cheap, cacheable) and/or a read API.

## Data sources (added incrementally)

- **APIs:** Ticketmaster Discovery, Eventbrite, SeatGeek, Meetup (need keys).
- **Scrapers:** Funcheap SF, Do415, SF Rec & Park, city/library calendars, venue sites.
- **User submissions:** form → moderation queue → `flagged` until approved.

## Database — DECIDED: Postgres + PostGIS on Neon

- **Neon** serverless Postgres (free tier) with the **PostGIS** extension for spatial
  queries ("events near X") and strong upsert/dedupe (`ON CONFLICT`).
- Reached from **Cloudflare Workers** via **Hyperdrive** (connection pooling for
  Postgres over the edge). Locally, the pipeline connects to Neon (or a local Postgres)
  directly with a standard connection string.
- Schema lives as plain SQL migrations so it works on any Postgres.

## Deployment — DECIDED: Cloudflare (host), AWS not used

- **Compute:** Cloudflare Workers. The scheduled "longworker" runs via **Cron Triggers**.
- **Caveat:** Workers have CPU/time limits, so heavy multi-source scraping is fanned out
  through **Cloudflare Queues** (one message per source/page) rather than one long run.
  During development the pipeline just runs as a local Node process — no limits.
- **Everything must stay free:** free API tiers only (no paid APIs like Meetup),
  Neon free tier, Nominatim for geocoding, free OSM tiles. No paid services anywhere.
- Worker core stays host-agnostic so this can move later if needed.

## Tech stack

- **Worker / pipeline:** Node + TypeScript, standalone package.
- **Frontend (later):** Vite + React + TypeScript + MapLibre GL.
- **Tiles:** OpenFreeMap or self-hosted Protomaps (free, no API key, restylable).
- **Geocoding:** OSM Nominatim + local cache.
- **Styling:** minimal — solid colors, clean type, no gradients/glow.

## Open decisions

- [x] **Database** — Postgres + PostGIS on Neon.
- [x] **Host** — Cloudflare (Workers + Cron Triggers + Queues + Hyperdrive).
- [x] **Sources** — all free APIs + scrapers; strictly zero-cost. Connectors for
      Ticketmaster, SeatGeek, Eventbrite, Luma, and Funcheap are all implemented.
      API sources (TM, SeatGeek, Eventbrite) read keys from env and self-skip with a
      logged notice when a key is absent; scrapers (Funcheap, Luma) need no keys and
      rate-limit themselves.

## Daily automation

`.github/workflows/daily-ingest.yml` runs the full pipeline on a daily cron
(migrate → ingest → sweep → export) and commits the refreshed `data/events.json`.
It is the primary scheduler (zero extra infra). To turn it on, add the repo Actions
secrets listed at the top of that workflow file — `DATABASE_URL` is required; the
connector keys are optional and each source self-skips without its key. A Cloudflare
Workers + Cron Triggers config is scaffolded in `worker/wrangler.toml.example` as the
eventual Phase 9 target. Locally: `cd worker && npm run daily`. See `docs/RUNBOOK.md`.

## Getting started (next step)

1. Create a free Neon project at neon.tech; in its SQL editor run `CREATE EXTENSION postgis;`
2. `cp worker/.env.example worker/.env` and paste the `DATABASE_URL`.
3. `cd worker && npm install`
4. `npm run migrate`  — creates the schema.
5. (optional) add `TICKETMASTER_API_KEY` to `.env`, then `npm run ingest`.
6. `npm run sweep` — runs the lifecycle pass.
7. `npm test` — dedup scoring unit tests.

See `docs/PIPELINE.md` for the connector protocol, dedup algorithm, and lifecycle.
