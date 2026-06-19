import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/push-log");

/**
 * The restart-safe dedup ledger. `tryClaim` is the atomic fire gate: the first
 * caller to insert a `(endpoint, fireKey)` wins; everyone else (later ticks,
 * overlapping ticks, post-restart re-runs) is rejected — idempotent sends.
 */
export interface PushLogRepo {
  /** Returns true iff THIS call inserted the row (i.e. won the fire). */
  tryClaim(endpoint: string, fireKey: string): Promise<boolean>;
  /** Delete ledger rows older than `olderThanMs` (daily housekeeping). */
  prune(olderThanMs: number): Promise<void>;
}

/** Postgres-backed implementation. */
export class PgPushLogRepo implements PushLogRepo {
  constructor(private readonly pool: pg.Pool) {}

  async tryClaim(endpoint: string, fireKey: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `INSERT INTO push_log (endpoint, fire_key)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [endpoint, fireKey],
    );
    return rows.length > 0;
  }

  async prune(olderThanMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const { rowCount } = await this.pool.query(
      "DELETE FROM push_log WHERE fired_at < $1",
      [cutoff],
    );
    log.info("Pruned push_log", { removed: rowCount ?? 0, olderThanMs });
  }
}
