# Runbook — turning on the daily ingestion

Companion to `PLAN.md` / `PIPELINE.md`. Everything below is free-tier only.

## 1. Provision the database (one-time)

1. Create a free Postgres project at [neon.tech](https://neon.tech).
2. In its SQL editor run: `CREATE EXTENSION postgis;` (the migration also creates
   `postgis` + `pg_trgm`, but Neon requires the extension be enabled for the project).
3. Copy the connection string (it becomes `DATABASE_URL`).

## 2. Configure secrets

Everything reads from env by name and fails with a clear message when `DATABASE_URL`
is absent. Names (values are yours to supply):

| name | required | source |
|------|----------|--------|
| `DATABASE_URL` | **yes** | Neon connection string (PostGIS enabled) |
| `TICKETMASTER_API_KEY` | optional | developer.ticketmaster.com (free) |
| `SEATGEEK_CLIENT_ID` | optional | platform.seatgeek.com (free) |
| `SEATGEEK_CLIENT_SECRET` | optional | platform.seatgeek.com companion secret |
| `EVENTBRITE_TOKEN` | optional | eventbrite.com/platform (private OAuth token) |
| `EVENTBRITE_ORG_ID` | optional | pin one Eventbrite org (else auto-discovered) |
| `NOMINATIM_USER_AGENT` | recommended | contact string for OSM geocoding fair use |
| `SCRAPER_USER_AGENT` | recommended | contact string when scraping Funcheap / Luma |

Any API source without its key logs a skip notice and contributes nothing — the run
still succeeds. Funcheap and Luma are scrapers and need no keys.

## 3. Run it

**Locally:**

```bash
cd worker
cp .env.example .env      # paste DATABASE_URL (+ any optional keys)
npm install
npm run daily             # migrate → ingest → sweep → export
```

Individual stages: `npm run migrate`, `npm run ingest`, `npm run sweep`,
`npm run export`. Tests: `npm test`. Typecheck: `npm run typecheck`.

The export writes `data/events.json` (override with `EVENTS_JSON_PATH`).

**Automated (GitHub Actions — primary):** add the secrets from the table above under
*Settings ▸ Secrets and variables ▸ Actions*, then the `daily-ingest` workflow runs
on its daily cron (or trigger it manually from the Actions tab). It commits the
refreshed `data/events.json` back to the repo.

**Cloudflare (Phase 9, optional):** `worker/wrangler.toml.example` scaffolds Workers +
Cron Triggers + Hyperdrive. Requires a Workers-compatible `scheduled` entry and moving
the export to R2/KV — see the comments in that file.
