import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("admin/queries/audience");

export interface Bucket {
  key: string;
  n: number;
}

export interface AudienceReport {
  /** Daily-active installs. NOT unique people, and NOT comparable across days. */
  activePerDay: { day: string; n: number }[];
  /**
   * Averages of the daily counts over the window. Named this way on purpose:
   * the install hash rotates daily (ADR-016), so cross-day uniques — real
   * WAU/MAU — cannot be computed from this table, and must never be claimed.
   */
  avg7d: number;
  avg30d: number;
  byPlatform: Bucket[];
  byVersion: Bucket[];
  byCountry: Bucket[];
  byLocSource: Bucket[];
  byArea: { city: string | null; country: string | null; n: number }[];
  features: Bucket[];
  notifEnabledPct: number;
  cells: { lat: number; lon: number; n: number }[];
  /** True when nothing has been recorded yet, so the UI can say why. */
  empty: boolean;
}

const EMPTY: AudienceReport = {
  activePerDay: [],
  avg7d: 0,
  avg30d: 0,
  byPlatform: [],
  byVersion: [],
  byCountry: [],
  byLocSource: [],
  byArea: [],
  features: [],
  notifEnabledPct: 0,
  cells: [],
  empty: true,
};

/**
 * All the audience breakdowns in one round trip.
 *
 * Every grouping is over the whole window (a row is one install-day), so a
 * "platform" count means install-days, not people. The UI labels it that way.
 */
export async function fetchAudience(pool: pg.Pool, days: number): Promise<AudienceReport> {
  const window = Math.min(Math.max(1, Math.floor(days)), 365);
  try {
    const { rows } = await pool.query(
      `WITH win AS (
         SELECT * FROM usage_ping WHERE day > CURRENT_DATE - $1::int
       ), per_day AS (
         SELECT day, COUNT(*)::int AS n FROM win GROUP BY day
       )
       SELECT
         (SELECT COALESCE(json_agg(x ORDER BY x.day), '[]'::json) FROM (
            SELECT to_char(day, 'YYYY-MM-DD') AS day, n FROM per_day) x) AS active_per_day,
         COALESCE((SELECT ROUND(AVG(n))::int FROM per_day WHERE day > CURRENT_DATE - 7), 0)  AS avg7,
         COALESCE((SELECT ROUND(AVG(n))::int FROM per_day WHERE day > CURRENT_DATE - 30), 0) AS avg30,
         (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT platform AS key, COUNT(*)::int AS n FROM win GROUP BY 1 ORDER BY n DESC) x) AS by_platform,
         (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT COALESCE(app_version, 'unknown') AS key, COUNT(*)::int AS n
              FROM win GROUP BY 1 ORDER BY n DESC LIMIT 12) x) AS by_version,
         (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT COALESCE(country, 'unknown') AS key, COUNT(*)::int AS n
              FROM win GROUP BY 1 ORDER BY n DESC LIMIT 20) x) AS by_country,
         (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT COALESCE(loc_source, 'unknown') AS key, COUNT(*)::int AS n
              FROM win GROUP BY 1 ORDER BY n DESC) x) AS by_loc_source,
         (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT city, country, COUNT(*)::int AS n
              FROM win GROUP BY 1, 2 ORDER BY n DESC LIMIT 25) x) AS by_area,
         (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            -- features is a TEXT[]; unnest so each enabled feature counts once.
            SELECT f AS key, COUNT(*)::int AS n
              FROM win, unnest(features) AS f GROUP BY 1 ORDER BY n DESC) x) AS features,
         COALESCE((SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE notif) / NULLIF(COUNT(*), 0))::int
                     FROM win), 0) AS notif_pct,
         (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
            SELECT lat, lon, COUNT(*)::int AS n
              FROM win WHERE lat IS NOT NULL AND lon IS NOT NULL
             GROUP BY 1, 2 ORDER BY n DESC LIMIT 500) x) AS cells,
         (SELECT COUNT(*)::int FROM win) AS total`,
      [window],
    );

    const r = rows[0];
    if (!r) return EMPTY;
    return {
      activePerDay: (r.active_per_day as { day: string; n: number }[]) ?? [],
      avg7d: Number(r.avg7 ?? 0),
      avg30d: Number(r.avg30 ?? 0),
      byPlatform: (r.by_platform as Bucket[]) ?? [],
      byVersion: (r.by_version as Bucket[]) ?? [],
      byCountry: (r.by_country as Bucket[]) ?? [],
      byLocSource: (r.by_loc_source as Bucket[]) ?? [],
      byArea: (r.by_area as { city: string | null; country: string | null; n: number }[]) ?? [],
      features: (r.features as Bucket[]) ?? [],
      notifEnabledPct: Number(r.notif_pct ?? 0),
      cells:
        (r.cells as { lat: number; lon: number; n: number }[])?.map((c) => ({
          lat: Number(c.lat),
          lon: Number(c.lon),
          n: Number(c.n),
        })) ?? [],
      empty: Number(r.total ?? 0) === 0,
    };
  } catch (err) {
    log.warn("audience query failed", err instanceof Error ? err : new Error(String(err)));
    return EMPTY;
  }
}
