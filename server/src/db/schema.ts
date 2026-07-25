import pg from "pg";
import { childLogger } from "../logger.js";

const log = childLogger("db/schema");

// Idempotent DDL — safe to run on every boot. Mirrors docs/NOTIFICATIONS.md §3.
// All objects live in the dedicated `prayer` database (the pool is already
// scoped to it). push_log is the restart-safe dedup ledger (the fix for home's
// in-memory Set); the FK cascade clears a subscriber's ledger on delete.
const DDL = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            SERIAL PRIMARY KEY,
  endpoint      TEXT UNIQUE NOT NULL,
  subscription  JSONB NOT NULL,
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  tz            TEXT NOT NULL,
  country       TEXT,
  method        TEXT NOT NULL DEFAULT 'MWL',
  asr           TEXT NOT NULL DEFAULT 'Standard',
  lead_minutes  INTEGER[] NOT NULL DEFAULT '{0}',
  prayers       TEXT[]  NOT NULL DEFAULT '{fajr,dhuhr,asr,maghrib,isha}',
  lang          TEXT NOT NULL DEFAULT 'ar',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_log (
  endpoint  TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  fire_key  TEXT NOT NULL,
  fired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (endpoint, fire_key)
);

CREATE INDEX IF NOT EXISTS idx_push_log_fired_at ON push_log (fired_at);

-- Multiple independent reminders per device (ported from the home project):
-- each rule fires its chosen targets at a chosen timing (at the time, or N
-- minutes before / after). The prayers column is a plain TEXT[] (no value CHECK)
-- so the fard + sunnah/adhkar targets are gated only by the zod schema at the
-- boundary. Replaces the single lead_minutes/prayers arrays on push_subscriptions
-- (those columns are kept but unused for back-compat).
CREATE TABLE IF NOT EXISTS prayer_alert_rules (
  id          SERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  timing      TEXT NOT NULL CHECK (timing IN ('at_time','before','after')),
  minutes     INTEGER,
  prayers     TEXT[] NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'notification' CHECK (kind IN ('notification','alarm')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prayer_alert_rules_endpoint ON prayer_alert_rules (endpoint);

-- 2026-07 migration: widen the timing CHECK to include 'after'. CREATE TABLE
-- IF NOT EXISTS never alters an already-deployed table, so drop and re-add the
-- constraint explicitly. Idempotent as a pair; existing rows all satisfy it.
-- (prayer_alert_rules_timing_check is Postgres's deterministic auto-name for the
-- inline column CHECK — verify on the VPS via pg_constraint after deploy.)
ALTER TABLE prayer_alert_rules DROP CONSTRAINT IF EXISTS prayer_alert_rules_timing_check;
ALTER TABLE prayer_alert_rules ADD CONSTRAINT prayer_alert_rules_timing_check
  CHECK (timing IN ('at_time','before','after'));

-- 2026-07 migration: per-rule kind ('notification' | 'alarm'). ADD COLUMN IF NOT
-- EXISTS covers already-deployed tables (CREATE TABLE IF NOT EXISTS never alters
-- them); the DROP/ADD pair normalizes the CHECK name on both fresh and migrated
-- installs. Idempotent; existing rows default to 'notification'.
-- (Verify prayer_alert_rules_kind_check in pg_constraint on the VPS after deploy.)
ALTER TABLE prayer_alert_rules ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'notification';
ALTER TABLE prayer_alert_rules DROP CONSTRAINT IF EXISTS prayer_alert_rules_kind_check;
ALTER TABLE prayer_alert_rules ADD CONSTRAINT prayer_alert_rules_kind_check
  CHECK (kind IN ('notification','alarm'));

-- 2026-07 (ADR-014): the nearest-masjid cell cache moved out of process memory.
-- It used to be a 500-entry in-process LRU that every deploy emptied, so a
-- redeploy re-bought every cell from Google. Rows are keyed by ~1.1 km grid cell
-- and carry the coverage the entry can vouch for (see places/cache.ts
-- cellIsUsable). fetched_at drives BOTH the read filter and a hard DELETE prune:
-- Google's Maps Platform terms permit caching Places content for at most 30 days,
-- so expiry here has to actually delete, not merely stop serving.
CREATE TABLE IF NOT EXISTS places_cache (
  cell_key      TEXT PRIMARY KEY,
  payload       JSONB NOT NULL,
  result_count  INTEGER NOT NULL,
  max_dist_km   REAL NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_places_cache_fetched_at ON places_cache (fetched_at);

-- 2026-07 (ADR-014): spend governor + telemetry.
--
-- The day column is always a PACIFIC calendar day, because that is the zone
-- Google's free tier resets in (midnight PT on the 1st) — see places/budget.ts.
-- A UTC day here would smear every monthly total across two billing months.
--
-- EVERY request is recorded, not only the ones that spend, so the governor paces
-- on the real active-client count instead of a guess. Identifiers are anonymous:
-- scope='client' is a random UUID the app generates for itself, scope='ip' is a
-- /24 (or /64) PREFIX — enough to throttle a sweeper, not enough to identify a
-- person, and no coordinate is ever stored against either.
CREATE TABLE IF NOT EXISTS places_usage (
  day        DATE NOT NULL,
  scope      TEXT NOT NULL,
  scope_id   TEXT NOT NULL,
  requests   INTEGER NOT NULL DEFAULT 0,
  spend      INTEGER NOT NULL DEFAULT 0,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (day, scope, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_places_usage_day ON places_usage (day);
CREATE INDEX IF NOT EXISTS idx_places_usage_scope ON places_usage (scope, scope_id, day);

-- Hourly outcome rollup: hit rate, load shape, and how much each outcome cost.
-- Aggregate only — no client or location, so it can be kept indefinitely.
CREATE TABLE IF NOT EXISTS places_stats (
  day      DATE NOT NULL,
  hour     SMALLINT NOT NULL,
  outcome  TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  units    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, hour, outcome)
);

-- Which cells are asked for, and which of those cost a live call. Deliberately
-- carries NO client id: a per-client cell history would be a location trail,
-- whereas this aggregate only answers "where would adding masjid data pay off".
CREATE TABLE IF NOT EXISTS places_cell_demand (
  day      DATE NOT NULL,
  cell_key TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  misses   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, cell_key)
);

-- Masjids added by this app's own users (ADR-014). This data is OURS: unlike
-- Google Places content it can be kept indefinitely, so it is what lets the
-- resident index keep improving instead of being frozen at whatever OSM has.
-- Contributions must be the contributor's own knowledge, never copied from
-- Google Maps — that is stated in the submission UI and is what keeps the
-- dataset legally clean.
--
-- Approved rows join the resident index for everyone; a contributor sees their
-- own pending row immediately, but from their own device's local copy, so no
-- unreviewed text is ever served to anyone else.
CREATE TABLE IF NOT EXISTS masjid_contributions (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  lat         REAL NOT NULL,
  lon         REAL NOT NULL,
  client_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE masjid_contributions DROP CONSTRAINT IF EXISTS masjid_contributions_status_check;
ALTER TABLE masjid_contributions ADD CONSTRAINT masjid_contributions_status_check
  CHECK (status IN ('pending','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_masjid_contributions_status ON masjid_contributions (status);
CREATE INDEX IF NOT EXISTS idx_masjid_contributions_client ON masjid_contributions (client_id, created_at);
`;

/** Apply the idempotent schema. Run once at startup, after createPool. */
export async function initDb(pool: pg.Pool): Promise<void> {
  await pool.query(DDL);
  log.info("Schema initialized (push_subscriptions, push_log, prayer_alert_rules, places_cache)");
}
