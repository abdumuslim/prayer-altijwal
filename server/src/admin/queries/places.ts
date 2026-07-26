import pg from "pg";
import { childLogger } from "../../logger.js";
import { cellCentre } from "../../places/cache.js";

const log = childLogger("admin/queries/places");

/** Every outcome places/routes.ts can record, in serving-cost order. */
export const PLACES_OUTCOMES = [
  "resident",
  "cache_mem",
  "cache_db",
  "live",
  "travel_cached",
  "travel_live",
  "degraded_upstream",
  "denied_budget",
  "denied_client",
  "denied_ip",
  "disabled",
] as const;

export type PlacesOutcomeName = (typeof PLACES_OUTCOMES)[number];

export interface OutcomeBucket {
  /** ISO date (UTC) for daily rows, or the hour 0-23 for today's breakdown. */
  key: string;
  outcomes: Record<string, number>;
  units: number;
  total: number;
}

export interface TopClient {
  /** Truncated identifier — never the whole client id. */
  scopeShort: string;
  requests: number;
  spend: number;
  lastSeen: string;
}

export interface DemandCell {
  cellKey: string;
  lat: number;
  lon: number;
  n: number;
  misses: number;
}

function clampDays(days: number): number {
  return Math.min(Math.max(1, Math.floor(days)), 365);
}

/**
 * Daily outcome mix. `day` here is a PACIFIC calendar day, because that is what
 * the writer records — Google's free tier resets at midnight PT, and mixing in
 * a UTC day would smear a month boundary across two billing months.
 */
export async function fetchDailyOutcomes(pool: pg.Pool, days: number): Promise<OutcomeBucket[]> {
  try {
    const { rows } = await pool.query(
      `SELECT day, outcome, SUM(n)::int AS n, SUM(units)::int AS units
         FROM places_stats
        WHERE day > CURRENT_DATE - $1::int
        GROUP BY day, outcome
        ORDER BY day`,
      [clampDays(days)],
    );
    return groupBuckets(rows, (r) => new Date(r.day as string).toISOString().slice(0, 10));
  } catch (err) {
    log.warn("daily outcomes failed", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}

/** Today's load shape, hour by hour. */
export async function fetchHourlyOutcomes(pool: pg.Pool): Promise<OutcomeBucket[]> {
  try {
    const { rows } = await pool.query(
      `SELECT hour, outcome, SUM(n)::int AS n, SUM(units)::int AS units
         FROM places_stats
        WHERE day = CURRENT_DATE
        GROUP BY hour, outcome
        ORDER BY hour`,
    );
    return groupBuckets(rows, (r) => String(r.hour));
  } catch (err) {
    log.warn("hourly outcomes failed", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}

/**
 * What each anonymous client has cost. `scope_id` for scope='client' is the
 * app's self-generated X-Client-Id; it is truncated here so the full value
 * never leaves the server.
 */
export async function fetchTopClients(
  pool: pg.Pool,
  days: number,
  limit: number,
): Promise<TopClient[]> {
  try {
    const { rows } = await pool.query(
      `SELECT scope_id, SUM(requests)::int AS requests, SUM(spend)::int AS spend,
              MAX(last_seen) AS last_seen
         FROM places_usage
        WHERE scope = 'client' AND day > CURRENT_DATE - $1::int
        GROUP BY scope_id
        ORDER BY spend DESC, requests DESC
        LIMIT $2`,
      [clampDays(days), Math.min(Math.max(1, Math.floor(limit)), 200)],
    );
    return rows.map((r) => ({
      scopeShort: shorten(String(r.scope_id)),
      requests: Number(r.requests ?? 0),
      spend: Number(r.spend ?? 0),
      lastSeen: new Date(r.last_seen as string).toISOString(),
    }));
  } catch (err) {
    log.warn("top clients failed", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}

/** Where masjid lookups are asked for. Carries no client id by design. */
export async function fetchDemand(
  pool: pg.Pool,
  days: number,
  limit: number,
): Promise<DemandCell[]> {
  try {
    const { rows } = await pool.query(
      `SELECT cell_key, SUM(n)::int AS n, SUM(misses)::int AS misses
         FROM places_cell_demand
        WHERE day > CURRENT_DATE - $1::int
        GROUP BY cell_key
        ORDER BY n DESC
        LIMIT $2`,
      [clampDays(days), Math.min(Math.max(1, Math.floor(limit)), 2000)],
    );
    const out: DemandCell[] = [];
    for (const r of rows) {
      const key = String(r.cell_key);
      const centre = cellCentre(key);
      if (!centre) continue; // malformed key from an old row — skip, don't crash
      out.push({
        cellKey: key,
        lat: centre.lat,
        lon: centre.lon,
        n: Number(r.n ?? 0),
        misses: Number(r.misses ?? 0),
      });
    }
    return out;
  } catch (err) {
    log.warn("demand query failed", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}

function groupBuckets(
  rows: Record<string, unknown>[],
  keyOf: (row: Record<string, unknown>) => string,
): OutcomeBucket[] {
  const byKey = new Map<string, OutcomeBucket>();
  for (const r of rows) {
    const key = keyOf(r);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, outcomes: {}, units: 0, total: 0 };
      byKey.set(key, bucket);
    }
    const n = Number(r.n ?? 0);
    bucket.outcomes[String(r.outcome)] = n;
    bucket.units += Number(r.units ?? 0);
    bucket.total += n;
  }
  return [...byKey.values()];
}

function shorten(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`;
}
