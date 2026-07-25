import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/places-usage");

/** How far back "recently active" looks when sizing the per-client share. */
export const ACTIVE_WINDOW_DAYS = 7;

/** Anonymous counters are kept this long, then deleted. */
export const USAGE_RETENTION_DAYS = 90;

/** Everything the governor needs to decide on one request. */
export interface UsageSnapshot {
  globalToday: number;
  clientToday: number;
  ipToday: number;
  isNewClient: boolean;
  usedThisMonth: number;
  activeClients: number;
}

export interface PlacesUsageRepo {
  /** Record that a request happened — cached, resident, or paid alike. */
  noteRequest(day: string, clientId: string, ipKey: string): Promise<void>;
  /** Read the counters behind an admission decision. */
  snapshot(
    day: string,
    monthPrefix: string,
    clientId: string,
    ipKey: string,
  ): Promise<UsageSnapshot>;
  /**
   * Commit an approved spend. The CLIENT increment is guarded by its cap inside
   * a single statement, so two concurrent requests cannot both slip past it;
   * returns false when the cap refused, and the caller degrades.
   */
  commitSpend(
    day: string,
    clientId: string,
    ipKey: string,
    units: number,
    clientCap: number,
  ): Promise<boolean>;
  prune(): Promise<number>;
}

const EMPTY: UsageSnapshot = {
  globalToday: 0,
  clientToday: 0,
  ipToday: 0,
  isNewClient: true,
  usedThisMonth: 0,
  activeClients: 0,
};

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Shift a `YYYY-MM-DD` key by whole days, staying in that calendar. */
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + delta));
  return shifted.toISOString().slice(0, 10);
}

/**
 * Anonymous usage counters for the spend governor (ADR-014).
 *
 * Never throws: telemetry must not be able to break the masjid list. A failed
 * read degrades to "no usage recorded", which is the conservative direction —
 * the governor then paces on the monthly cap alone.
 */
export function createPlacesUsageRepo(pool: pg.Pool): PlacesUsageRepo {
  return {
    async noteRequest(day, clientId, ipKey) {
      try {
        await pool.query(
          `INSERT INTO places_usage AS u (day, scope, scope_id, requests, spend, last_seen)
                VALUES ($1,'client',$2,1,0,NOW()), ($1,'ip',$3,1,0,NOW())
           ON CONFLICT (day, scope, scope_id) DO UPDATE
                   SET requests = u.requests + 1, last_seen = NOW()`,
          [day, clientId, ipKey],
        );
      } catch (err) {
        log.warn("noteRequest failed", err instanceof Error ? err : new Error(String(err)));
      }
    },

    async snapshot(day, monthPrefix, clientId, ipKey) {
      try {
        const since = shiftDay(day, -ACTIVE_WINDOW_DAYS);
        const { rows } = await pool.query(
          `SELECT
             (SELECT COALESCE(SUM(spend),0) FROM places_usage
               WHERE day = $1 AND scope = 'client')                        AS global_today,
             (SELECT COALESCE(SUM(spend),0) FROM places_usage
               WHERE day = $1 AND scope = 'client' AND scope_id = $3)      AS client_today,
             (SELECT COALESCE(SUM(spend),0) FROM places_usage
               WHERE day = $1 AND scope = 'ip' AND scope_id = $4)          AS ip_today,
             (SELECT COALESCE(SUM(spend),0) FROM places_usage
               WHERE scope = 'client' AND to_char(day,'YYYY-MM') = $2)     AS used_this_month,
             (SELECT COUNT(DISTINCT scope_id) FROM places_usage
               WHERE scope = 'client' AND spend > 0 AND day > $5)          AS active_clients,
             (SELECT COUNT(*) FROM places_usage
               WHERE scope = 'client' AND scope_id = $3 AND spend > 0)     AS prior_spends`,
          [day, monthPrefix, clientId, ipKey, since],
        );
        const r = rows[0];
        if (!r) return EMPTY;
        return {
          globalToday: int(r.global_today),
          clientToday: int(r.client_today),
          ipToday: int(r.ip_today),
          usedThisMonth: int(r.used_this_month),
          activeClients: int(r.active_clients),
          isNewClient: int(r.prior_spends) === 0,
        };
      } catch (err) {
        log.warn("usage snapshot failed", err instanceof Error ? err : new Error(String(err)));
        return EMPTY;
      }
    },

    async commitSpend(day, clientId, ipKey, units, clientCap) {
      try {
        // The cap check and the increment are ONE statement, so concurrent
        // requests from the same client cannot both observe "under the cap".
        const { rows } = await pool.query(
          `INSERT INTO places_usage AS u (day, scope, scope_id, requests, spend, last_seen)
                VALUES ($1,'client',$2,0,$3,NOW())
           ON CONFLICT (day, scope, scope_id) DO UPDATE
                   SET spend = u.spend + $3, last_seen = NOW()
                 WHERE u.spend + $3 <= $4
             RETURNING spend`,
          [day, clientId, units, clientCap],
        );
        if (rows.length === 0) return false;

        // The IP tally is bookkeeping behind the client cap, so it is not
        // guarded — a refusal here would waste a call already approved.
        await pool.query(
          `INSERT INTO places_usage AS u (day, scope, scope_id, requests, spend, last_seen)
                VALUES ($1,'ip',$2,0,$3,NOW())
           ON CONFLICT (day, scope, scope_id) DO UPDATE
                   SET spend = u.spend + $3, last_seen = NOW()`,
          [day, ipKey, units],
        );
        return true;
      } catch (err) {
        log.warn("commitSpend failed", err instanceof Error ? err : new Error(String(err)));
        // Fail CLOSED: an uncountable spend is one we must not make.
        return false;
      }
    },

    async prune() {
      try {
        const res = await pool.query(
          `DELETE FROM places_usage WHERE day < CURRENT_DATE - ($1 || ' days')::INTERVAL`,
          [String(USAGE_RETENTION_DAYS)],
        );
        return res.rowCount ?? 0;
      } catch (err) {
        log.warn("usage prune failed", err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    },
  };
}
