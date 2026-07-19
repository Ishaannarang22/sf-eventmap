# SF Event Map

A map of (ideally) every local event in the San Francisco Bay Area — pinned by location, with filtering by category, date, price, and search.

> **Status: early work-in-progress.** The data pipeline is the current focus and partially built; the map frontend does not exist yet. See the roadmap below.

## Guiding principle: pipeline before delivery

The map is the easy part. The hard, valuable part is the **data pipeline** — sourcing events from many places, normalizing them into one shape, deduplicating the inevitable overlap, geocoding to coordinates, and curating quality. That pipeline gets built and hardened first; the frontend will just be a consumer of a clean dataset.

```
  SOURCES                  PIPELINE                         OUTPUT
  ┌───────────┐
  │ APIs      │──┐
  │ scrapers  │──┤   ingest → normalize → dedupe →    ┌─→ Postgres (canonical store)
  │ user subs │──┘   geocode → curate/score           └─→ events.json (served to map)
  └───────────┘
```

## Repository layout

- `worker/` — the ingestion pipeline: a standalone Node + TypeScript package that fetches, normalizes, geocodes, dedupes, and retires events. Runs locally today; destined for Cloudflare Workers (Cron Triggers + Queues) later.
  - `src/sources/` — one connector per platform (Ticketmaster, SeatGeek, Eventbrite, Luma, Funcheap). Adding a platform = one new file, no pipeline changes.
  - `src/pipeline/` — ingest run, dedupe/merge engine, lifecycle sweeper.
  - `src/db/` — Neon Postgres client and SQL migrations.
- `docs/PLAN.md` — overall plan, schema, build order, decisions.
- `docs/PIPELINE.md` — connector protocol, dedup algorithm, and event lifecycle in detail.

## How it works

Each run, per source: **fetch** raw events → **store raw** (upsert, staleness tracking) → **normalize** into a single `Event` shape → **geocode** missing coordinates via Nominatim (with caching) → **dedupe/merge** into one canonical row per real-world event → a separate scheduled **sweeper** retires events that have ended or gone stale.

Deduplication is the core: events in the same date + ~110m geo cell are pairwise-scored on fuzzy title similarity, start-time proximity, location proximity, and URL host. High scores merge (keeping the richest fields from the most trusted source); ambiguous scores get flagged for review. Details in [`docs/PIPELINE.md`](docs/PIPELINE.md).

## Tech stack

- **Pipeline:** Node + TypeScript, `@neondatabase/serverless`, cheerio (scrapers), vitest.
- **Database:** Postgres + PostGIS on Neon (free tier), reached from Workers via Hyperdrive later.
- **Geocoding:** OSM Nominatim (rate-limited, cached).
- **Frontend (planned):** Vite + React + TypeScript + MapLibre GL on free OSM-based tiles.
- **Hosting (planned):** Cloudflare Workers + Cron Triggers + Queues.
- **Cost:** everything stays on free tiers — no paid APIs or services.

## Current state

| Piece | Status |
|---|---|
| Worker scaffold, DB schema, migration runner | Done |
| Connector protocol + 5 source connectors | Ticketmaster complete; SeatGeek/Eventbrite/Luma/Funcheap stubbed |
| Geocoding (Nominatim + cache) | Done |
| Dedup engine (scoring + blocking + merge) | Scoring done, unit-tested |
| Lifecycle sweeper (retire ended/stale events) | Done |
| First real ingest against Neon | Next up |
| Remaining connector bodies, curation, export, frontend, deploy | Not started |

## Getting started

1. Create a free Neon project at [neon.tech](https://neon.tech); in its SQL editor run `CREATE EXTENSION postgis;`
2. `cp worker/.env.example worker/.env` and paste your `DATABASE_URL`.
3. `cd worker && npm install`
4. `npm run migrate` — creates the schema.
5. (optional) add `TICKETMASTER_API_KEY` to `.env`, then `npm run ingest`.
6. `npm run sweep` — runs the lifecycle pass.
7. `npm test` — dedup scoring unit tests.

## Roadmap

1. Connect Neon and land the first real ingest.
2. Fill in the remaining connector `fetch()` bodies (SeatGeek, Eventbrite, Luma, Funcheap; then Do415, SF Rec & Park, city calendars).
3. Curation / quality scoring and a review queue.
4. Export `events.json` / read API.
5. Frontend: MapLibre map with markers, clustering, and filters.
6. User submissions with moderation.
7. Cloudflare deploy: Workers + Cron + Hyperdrive.
