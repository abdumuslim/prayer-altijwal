import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/places-stats");

const FLUSH_INTERVAL_MS = 15_000;

/** Aggregate rollups carry no client or coordinate, so they can be kept. */
export const CELL_DEMAND_RETENTION_DAYS = 400;

/** How a request was answered — one of these is recorded for EVERY request. */
export type PlacesOutcome =
  | "resident"
  | "cache_mem"
  | "cache_db"
  | "live"
  | "denied_budget"
  | "denied_client"
  | "denied_ip"
  | "degraded_upstream"
  | "disabled"
  // On-expand travel lookups. Separate names so the rollup shows what each
  // endpoint costs, rather than blending two different prices into one row.
  | "travel_live"
  | "travel_cached";

export interface PlacesStatsRecorder {
  noteOutcome(day: string, hour: number, outcome: PlacesOutcome, units: number): void;
  noteCell(day: string, cellKey: string, miss: boolean): void;
  /** Write the buffer out. Safe to call at any time; used by tests and shutdown. */
  flush(): Promise<void>;
  /**
   * Delete places_cell_demand rows older than `olderThanDays`. This aggregate
   * had no retention — it grew a row per (PT day × cell) forever — so the daily
   * sweep now trims it like the other rollups. Returns the row count removed.
   */
  pruneCellDemand(olderThanDays: number): Promise<number>;
  start(): void;
  stop(): void;
}

/**
 * Buffered analytics writer (ADR-014).
 *
 * Every request is counted, but counting must not put a synchronous database
 * write on the hot path — so outcomes and cell demand accumulate in memory and
 * flush on a timer. Losing the last few seconds to a crash costs a slightly low
 * chart, which is the right trade; the counters that GATE spending are written
 * synchronously in places-usage.ts, not here.
 */
export function createPlacesStatsRecorder(pool: pg.Pool): PlacesStatsRecorder {
  // key `day|hour|outcome` → [n, units]
  const outcomes = new Map<string, [number, number]>();
  // key `day|cell` → [n, misses]
  const cells = new Map<string, [number, number]>();
  let timer: NodeJS.Timeout | undefined;

  const bump = (m: Map<string, [number, number]>, key: string, a: number, b: number): void => {
    const cur = m.get(key);
    if (cur) {
      cur[0] += a;
      cur[1] += b;
    } else {
      m.set(key, [a, b]);
    }
  };

  async function flush(): Promise<void> {
    if (outcomes.size === 0 && cells.size === 0) return;
    // Swap the buffers first so concurrent requests keep accumulating into a
    // fresh map rather than being dropped mid-write.
    const outSnapshot = [...outcomes.entries()];
    const cellSnapshot = [...cells.entries()];
    outcomes.clear();
    cells.clear();

    try {
      for (const [key, [n, units]] of outSnapshot) {
        const [day, hour, outcome] = key.split("|");
        await pool.query(
          `INSERT INTO places_stats AS s (day, hour, outcome, n, units)
                VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (day, hour, outcome) DO UPDATE
                   SET n = s.n + EXCLUDED.n, units = s.units + EXCLUDED.units`,
          [day, Number(hour), outcome, n, units],
        );
      }
      for (const [key, [n, misses]] of cellSnapshot) {
        const sep = key.indexOf("|");
        const day = key.slice(0, sep);
        const cell = key.slice(sep + 1);
        await pool.query(
          `INSERT INTO places_cell_demand AS c (day, cell_key, n, misses)
                VALUES ($1,$2,$3,$4)
           ON CONFLICT (day, cell_key) DO UPDATE
                   SET n = c.n + EXCLUDED.n, misses = c.misses + EXCLUDED.misses`,
          [day, cell, n, misses],
        );
      }
    } catch (err) {
      // The counts are already out of the buffer; losing them beats retrying
      // forever against a database that is unwell.
      log.warn("stats flush failed", err instanceof Error ? err : new Error(String(err)));
    }
  }

  return {
    noteOutcome(day, hour, outcome, units) {
      bump(outcomes, `${day}|${hour}|${outcome}`, 1, units);
    },
    noteCell(day, cellKey, miss) {
      bump(cells, `${day}|${cellKey}`, 1, miss ? 1 : 0);
    },
    flush,
    async pruneCellDemand(olderThanDays) {
      // Self-guards so a failure here can't stall the daily retention sweep, the
      // same contract the other pruners keep. `day` is a PT calendar day.
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM places_cell_demand WHERE day < CURRENT_DATE - ($1::int)`,
          [Math.max(1, Math.floor(olderThanDays))],
        );
        return rowCount ?? 0;
      } catch (err) {
        log.warn("cell demand prune failed", err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    },
    start() {
      if (timer) return;
      timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      void flush();
    },
  };
}
