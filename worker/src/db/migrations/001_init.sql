-- SF Event Map — initial schema
-- Postgres + PostGIS + pg_trgm. Designed for multi-source ingest, fuzzy dedup,
-- and a lifecycle sweeper that retires events once they are over.

CREATE EXTENSION IF NOT EXISTS postgis;   -- geography(point) + ST_DWithin distance queries
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram similarity for fuzzy title matching

-- ---------------------------------------------------------------------------
-- sources: registry of every connector. trust_rank decides which source "wins"
-- when the same field disagrees across sources (lower rank = more trusted).
-- ---------------------------------------------------------------------------
CREATE TABLE sources (
  key         TEXT PRIMARY KEY,          -- 'luma' | 'eventbrite' | 'ticketmaster' | 'scrape:funcheap'
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- 'api' | 'semi-api' | 'scrape'
  trust_rank  INT  NOT NULL DEFAULT 100, -- lower = more trusted for field precedence
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_ok     BOOLEAN
);

-- ---------------------------------------------------------------------------
-- raw_events: verbatim payload from a source, keyed by (source, source_id).
-- This is also the link table: canonical_id points at the deduped event.
-- content_hash lets us skip work when a payload hasn't changed.
-- missing_runs increments when a source stops reporting an event -> staleness.
-- ---------------------------------------------------------------------------
CREATE TABLE raw_events (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL REFERENCES sources(key),
  source_id     TEXT NOT NULL,           -- id within that source
  payload       JSONB NOT NULL,          -- raw, so we can re-normalize without re-fetching
  content_hash  TEXT NOT NULL,
  url           TEXT,
  canonical_id  TEXT REFERENCES events(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  missing_runs  INT NOT NULL DEFAULT 0,
  UNIQUE (source, source_id)
);

-- ---------------------------------------------------------------------------
-- events: the canonical, deduped event. One row per real-world event, even if
-- five sources reported it. Normalized fields are merged from contributors.
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id             TEXT PRIMARY KEY,        -- stable id (see util/hash canonicalKey)
  title          TEXT NOT NULL,
  title_norm     TEXT NOT NULL,           -- lowercased/stripped, for trigram matching
  description    TEXT,
  category       TEXT NOT NULL DEFAULT 'other',
  start_at       TIMESTAMPTZ NOT NULL,
  end_at         TIMESTAMPTZ,
  tz             TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  venue          TEXT,
  address        TEXT,
  geo            GEOGRAPHY(POINT, 4326),  -- lng/lat; NULL until geocoded
  price_min      NUMERIC,
  price_max      NUMERIC,
  is_free        BOOLEAN,
  currency       TEXT DEFAULT 'USD',
  url            TEXT,
  image          TEXT,
  primary_source TEXT REFERENCES sources(key),  -- owns canonical fields
  dedupe_block   TEXT NOT NULL,           -- date-bucket + geo-cell; only compare within a block
  status         TEXT NOT NULL DEFAULT 'active', -- active|flagged|ended|stale|removed
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at_swept TIMESTAMPTZ              -- when the lifecycle sweeper retired it
);

-- raw_events.canonical_id references events.id, declared after events exists.
ALTER TABLE raw_events
  ADD CONSTRAINT raw_events_canonical_fk
  FOREIGN KEY (canonical_id) REFERENCES events(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- geocode_cache: address -> coords, so we never re-hit Nominatim for the same
-- string (respects their fair-use rate limits and keeps us free).
-- ---------------------------------------------------------------------------
CREATE TABLE geocode_cache (
  query        TEXT PRIMARY KEY,         -- normalized "venue, address" string
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  display_name TEXT,
  hit          BOOLEAN NOT NULL DEFAULT TRUE, -- false = geocoder found nothing (negative cache)
  geocoded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- events_archive: events keep living here after the sweeper hard-removes them,
-- for history/analytics. Same shape as events.
-- ---------------------------------------------------------------------------
CREATE TABLE events_archive (LIKE events INCLUDING ALL);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX events_geo_gix       ON events USING GIST (geo);
CREATE INDEX events_title_trgm    ON events USING GIN (title_norm gin_trgm_ops);
CREATE INDEX events_block_idx     ON events (dedupe_block);
CREATE INDEX events_start_idx     ON events (start_at);
CREATE INDEX events_status_idx    ON events (status);
CREATE INDEX raw_canonical_idx    ON raw_events (canonical_id);
