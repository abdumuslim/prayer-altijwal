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
-- each rule fires its chosen prayers at a chosen timing (at the time, or N
-- minutes before). Replaces the single lead_minutes/prayers arrays on
-- push_subscriptions (those columns are kept but unused for back-compat).
CREATE TABLE IF NOT EXISTS prayer_alert_rules (
  id          SERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  timing      TEXT NOT NULL CHECK (timing IN ('at_time','before')),
  minutes     INTEGER,
  prayers     TEXT[] NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prayer_alert_rules_endpoint ON prayer_alert_rules (endpoint);
`;

/** Apply the idempotent schema. Run once at startup, after createPool. */
export async function initDb(pool: pg.Pool): Promise<void> {
  await pool.query(DDL);
  log.info("Schema initialized (push_subscriptions, push_log, prayer_alert_rules)");
}
