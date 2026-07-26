import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("admin/queries/overview");

export interface AdminCounts {
  subscriptions: number;
  alertRules: number;
  contributionsPending: number;
  contributionsTotal: number;
  /** Approved user contributions — the community layer of the resident index. */
  communityApproved: number;
}

export interface AudienceSummary {
  activeToday: number;
  activeYesterday: number;
  /**
   * AVERAGE of daily-active counts over the window — NOT unique users. The
   * install hash rotates daily by design (ADR-016), so cross-day uniques are
   * uncomputable from stored data. Label it as such everywhere it surfaces.
   */
  avg7d: number;
  avg30d: number;
}

const ZERO_COUNTS: AdminCounts = {
  subscriptions: 0,
  alertRules: 0,
  contributionsPending: 0,
  contributionsTotal: 0,
  communityApproved: 0,
};

const ZERO_AUDIENCE: AudienceSummary = {
  activeToday: 0,
  activeYesterday: 0,
  avg7d: 0,
  avg30d: 0,
};

/** One round trip for every headline number. Returns zeros if the DB is down. */
export async function fetchCounts(pool: pg.Pool): Promise<AdminCounts> {
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM push_subscriptions)                              AS subscriptions,
         (SELECT COUNT(*)::int FROM prayer_alert_rules)                              AS alert_rules,
         (SELECT COUNT(*)::int FROM masjid_contributions WHERE status = 'pending')   AS pending,
         (SELECT COUNT(*)::int FROM masjid_contributions)                            AS total,
         (SELECT COUNT(*)::int FROM masjid_contributions WHERE status = 'approved')  AS approved`,
    );
    const r = rows[0];
    if (!r) return ZERO_COUNTS;
    return {
      subscriptions: Number(r.subscriptions ?? 0),
      alertRules: Number(r.alert_rules ?? 0),
      contributionsPending: Number(r.pending ?? 0),
      contributionsTotal: Number(r.total ?? 0),
      communityApproved: Number(r.approved ?? 0),
    };
  } catch (err) {
    log.warn("counts query failed", err instanceof Error ? err : new Error(String(err)));
    return ZERO_COUNTS;
  }
}

/**
 * Daily-active installs. `day` is the server's UTC calendar day, matching what
 * the telemetry writer stores.
 */
export async function fetchAudienceSummary(pool: pg.Pool): Promise<AudienceSummary> {
  try {
    const { rows } = await pool.query(
      `WITH per_day AS (
         SELECT day, COUNT(*)::int AS n
           FROM usage_ping
          WHERE day > CURRENT_DATE - 30
          GROUP BY day
       )
       SELECT
         COALESCE((SELECT n FROM per_day WHERE day = CURRENT_DATE), 0)     AS today,
         COALESCE((SELECT n FROM per_day WHERE day = CURRENT_DATE - 1), 0) AS yesterday,
         COALESCE((SELECT ROUND(AVG(n))::int FROM per_day WHERE day > CURRENT_DATE - 7), 0)  AS avg7,
         COALESCE((SELECT ROUND(AVG(n))::int FROM per_day), 0)                               AS avg30`,
    );
    const r = rows[0];
    if (!r) return ZERO_AUDIENCE;
    return {
      activeToday: Number(r.today ?? 0),
      activeYesterday: Number(r.yesterday ?? 0),
      avg7d: Number(r.avg7 ?? 0),
      avg30d: Number(r.avg30 ?? 0),
    };
  } catch (err) {
    log.warn("audience query failed", err instanceof Error ? err : new Error(String(err)));
    return ZERO_AUDIENCE;
  }
}
