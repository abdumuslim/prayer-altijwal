import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/push-stats");

export const PUSH_STATS_RETENTION_DAYS = 400;

export type PushOutcome = "sent" | "failed" | "gone";

/** One counter bump: a (day, kind, outcome) triple and how many to add. */
export interface PushStatDelta {
  day: string; // YYYY-MM-DD, server UTC
  kind: string; // 'notification' | 'alarm'
  outcome: PushOutcome;
  n: number;
}

export interface PushStatsRepo {
  /** Additive upsert — safe to call from overlapping ticks. Never throws. */
  add(deltas: PushStatDelta[]): Promise<void>;
  prune(olderThanDays: number): Promise<number>;
}

/**
 * Durable delivery history.
 *
 * push_log is a dedup ledger pruned at 48h, so it cannot answer "how many
 * reminders went out last month". This rollup can, and it holds no endpoint and
 * no subscriber — only counts.
 */
export function createPushStatsRepo(pool: pg.Pool): PushStatsRepo {
  return {
    async add(deltas) {
      if (deltas.length === 0) return;
      try {
        // One statement for the whole batch; the additive DO UPDATE means two
        // concurrent ticks can never lose a count.
        const values: unknown[] = [];
        const tuples = deltas.map((d, i) => {
          values.push(d.day, d.kind, d.outcome, Math.max(0, Math.floor(d.n)));
          const b = i * 4;
          return `($${b + 1}::date, $${b + 2}, $${b + 3}, $${b + 4}::int)`;
        });
        await pool.query(
          `INSERT INTO push_stats (day, kind, outcome, n)
                VALUES ${tuples.join(", ")}
           ON CONFLICT (day, kind, outcome)
           DO UPDATE SET n = push_stats.n + EXCLUDED.n`,
          values,
        );
      } catch (err) {
        // Telemetry must never break delivery.
        log.warn("push stats write failed", err instanceof Error ? err : new Error(String(err)));
      }
    },

    async prune(olderThanDays) {
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM push_stats WHERE day < CURRENT_DATE - ($1::int)`,
          [Math.max(1, Math.floor(olderThanDays))],
        );
        return rowCount ?? 0;
      } catch (err) {
        log.warn("push stats prune failed", err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    },
  };
}
