import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("admin/queries/push");

export interface PushSummary {
  subscriptions: {
    total: number;
    byCountry: { key: string; n: number }[];
    byTz: { key: string; n: number }[];
    newPerDay: { day: string; n: number }[];
  };
  rules: {
    total: number;
    byPrayer: { key: string; n: number }[];
    byKind: { key: string; n: number }[];
    byTiming: { key: string; n: number }[];
  };
  sends: { day: string; sent: number; failed: number; gone: number }[];
}

const EMPTY: PushSummary = {
  subscriptions: { total: 0, byCountry: [], byTz: [], newPerDay: [] },
  rules: { total: 0, byPrayer: [], byKind: [], byTiming: [] },
  sends: [],
};

export interface SubscriberRow {
  id: number;
  /** HOST of the push endpoint only — the full URL is a bearer credential. */
  endpointHost: string;
  country: string | null;
  tz: string | null;
  /** Rounded to 2 dp: enough to see "which city", not a precise location. */
  lat: number | null;
  lon: number | null;
  lang: string | null;
  rules: number;
  createdAt: string;
  updatedAt: string;
}

/** One round trip per grouping; a DB hiccup degrades to zeros, never a 500. */
export async function fetchPushSummary(pool: pg.Pool, days: number): Promise<PushSummary> {
  const window = Math.min(Math.max(1, Math.floor(days)), 365);
  try {
    const [subs, rules, sends] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM push_subscriptions) AS total,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
              SELECT COALESCE(country, 'unknown') AS key, COUNT(*)::int AS n
                FROM push_subscriptions GROUP BY 1 ORDER BY n DESC LIMIT 20) x) AS by_country,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
              SELECT COALESCE(tz, 'unknown') AS key, COUNT(*)::int AS n
                FROM push_subscriptions GROUP BY 1 ORDER BY n DESC LIMIT 20) x) AS by_tz,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
              SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n
                FROM push_subscriptions
               WHERE created_at > NOW() - ($1::int * INTERVAL '1 day')
               GROUP BY 1 ORDER BY 1) x) AS new_per_day`,
        [window],
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM prayer_alert_rules) AS total,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
              -- prayers is a TEXT[]; unnest so each target is counted once.
              SELECT p AS key, COUNT(*)::int AS n
                FROM prayer_alert_rules, unnest(prayers) AS p
               GROUP BY 1 ORDER BY n DESC) x) AS by_prayer,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
              SELECT kind AS key, COUNT(*)::int AS n
                FROM prayer_alert_rules GROUP BY 1 ORDER BY n DESC) x) AS by_kind,
           (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
              SELECT timing AS key, COUNT(*)::int AS n
                FROM prayer_alert_rules GROUP BY 1 ORDER BY n DESC) x) AS by_timing`,
      ),
      pool.query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day,
                SUM(n) FILTER (WHERE outcome = 'sent')::int   AS sent,
                SUM(n) FILTER (WHERE outcome = 'failed')::int AS failed,
                SUM(n) FILTER (WHERE outcome = 'gone')::int   AS gone
           FROM push_stats
          WHERE day > CURRENT_DATE - $1::int
          GROUP BY day ORDER BY day`,
        [window],
      ),
    ]);

    const s = subs.rows[0] ?? {};
    const r = rules.rows[0] ?? {};
    return {
      subscriptions: {
        total: Number(s.total ?? 0),
        byCountry: (s.by_country as { key: string; n: number }[]) ?? [],
        byTz: (s.by_tz as { key: string; n: number }[]) ?? [],
        newPerDay: (s.new_per_day as { day: string; n: number }[]) ?? [],
      },
      rules: {
        total: Number(r.total ?? 0),
        byPrayer: (r.by_prayer as { key: string; n: number }[]) ?? [],
        byKind: (r.by_kind as { key: string; n: number }[]) ?? [],
        byTiming: (r.by_timing as { key: string; n: number }[]) ?? [],
      },
      sends: sends.rows.map((row) => ({
        day: String(row.day),
        sent: Number(row.sent ?? 0),
        failed: Number(row.failed ?? 0),
        gone: Number(row.gone ?? 0),
      })),
    };
  } catch (err) {
    log.warn("push summary failed", err instanceof Error ? err : new Error(String(err)));
    return EMPTY;
  }
}

/**
 * Subscriber list for the dashboard.
 *
 * PRIVACY: the endpoint is reduced to its host and the coordinates to 2 dp,
 * IN SQL, so the sensitive forms never enter the process at all. push_
 * subscriptions is the one table holding precise, retained, coordinate-linked
 * data (docs/NOTIFICATIONS.md), and the dashboard has no reason to see it.
 */
export async function fetchSubscribers(pool: pg.Pool, limit: number): Promise<SubscriberRow[]> {
  try {
    const { rows } = await pool.query(
      `SELECT s.id,
              split_part(split_part(s.endpoint, '://', 2), '/', 1) AS endpoint_host,
              s.country, s.tz, s.lang,
              ROUND(s.lat::numeric, 2) AS lat,
              ROUND(s.lon::numeric, 2) AS lon,
              s.created_at, s.updated_at,
              (SELECT COUNT(*)::int FROM prayer_alert_rules r WHERE r.endpoint = s.endpoint) AS rules
         FROM push_subscriptions s
        ORDER BY s.created_at DESC
        LIMIT $1`,
      [Math.min(Math.max(1, Math.floor(limit)), 500)],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      endpointHost: String(r.endpoint_host || "unknown"),
      country: r.country ?? null,
      tz: r.tz ?? null,
      lat: r.lat === null ? null : Number(r.lat),
      lon: r.lon === null ? null : Number(r.lon),
      lang: r.lang ?? null,
      rules: Number(r.rules ?? 0),
      createdAt: new Date(r.created_at as string).toISOString(),
      updatedAt: new Date(r.updated_at as string).toISOString(),
    }));
  } catch (err) {
    log.warn("subscriber list failed", err instanceof Error ? err : new Error(String(err)));
    return [];
  }
}
