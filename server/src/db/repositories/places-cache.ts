import pg from "pg";
import { childLogger } from "../../logger.js";
import type { Masjid } from "../../places/google-places.js";

const log = childLogger("db/places-cache");

/**
 * Hard retention limit for cached Google Places content.
 *
 * This is a COMPLIANCE constant, not a tuning knob: the Google Maps Platform
 * terms allow caching Places content for at most 30 consecutive days (place IDs
 * alone may be kept indefinitely). Raising it would put the project in breach —
 * if entries need to live longer, the answer is the resident OpenStreetMap
 * dataset, whose licence permits it.
 */
export const CACHE_MAX_AGE_DAYS = 30;

/** A cached cell: the masjids plus the coverage the entry can vouch for. */
export interface CachedCell {
  masjids: Masjid[];
  resultCount: number;
  maxDistKm: number;
  fetchedAt: Date;
}

export interface PlacesCacheRepo {
  get(cellKey: string): Promise<CachedCell | null>;
  put(cellKey: string, cell: Omit<CachedCell, "fetchedAt">): Promise<void>;
  /** Delete everything past the retention limit. Returns rows removed. */
  prune(): Promise<number>;
}

function toMasjids(payload: unknown): Masjid[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(
    (m): m is Masjid =>
      typeof m === "object" &&
      m !== null &&
      typeof (m as Masjid).id === "string" &&
      typeof (m as Masjid).name === "string" &&
      Number.isFinite((m as Masjid).lat) &&
      Number.isFinite((m as Masjid).lon),
  );
}

/**
 * Restart-safe cell cache (docs/DECISIONS.md ADR-014). Never throws: a database
 * hiccup must degrade the masjid list to a live call, never 500 the request.
 */
export function createPlacesCacheRepo(pool: pg.Pool): PlacesCacheRepo {
  return {
    async get(cellKey) {
      try {
        const { rows } = await pool.query(
          `SELECT payload, result_count, max_dist_km, fetched_at
             FROM places_cache
            WHERE cell_key = $1
              AND fetched_at > NOW() - ($2 || ' days')::INTERVAL`,
          [cellKey, String(CACHE_MAX_AGE_DAYS)],
        );
        const row = rows[0];
        if (!row) return null;
        return {
          masjids: toMasjids(row.payload),
          resultCount: Number(row.result_count),
          maxDistKm: Number(row.max_dist_km),
          fetchedAt: new Date(row.fetched_at),
        };
      } catch (err) {
        log.warn("places_cache read failed", err instanceof Error ? err : new Error(String(err)));
        return null;
      }
    },

    async put(cellKey, cell) {
      try {
        await pool.query(
          `INSERT INTO places_cache (cell_key, payload, result_count, max_dist_km, fetched_at)
                VALUES ($1, $2::jsonb, $3, $4, NOW())
           ON CONFLICT (cell_key) DO UPDATE
                   SET payload = EXCLUDED.payload,
                       result_count = EXCLUDED.result_count,
                       max_dist_km = EXCLUDED.max_dist_km,
                       fetched_at = EXCLUDED.fetched_at`,
          [cellKey, JSON.stringify(cell.masjids), cell.resultCount, cell.maxDistKm],
        );
      } catch (err) {
        log.warn("places_cache write failed", err instanceof Error ? err : new Error(String(err)));
      }
    },

    async prune() {
      try {
        const res = await pool.query(
          `DELETE FROM places_cache WHERE fetched_at <= NOW() - ($1 || ' days')::INTERVAL`,
          [String(CACHE_MAX_AGE_DAYS)],
        );
        const removed = res.rowCount ?? 0;
        if (removed > 0) log.info("places_cache pruned", { removed, maxAgeDays: CACHE_MAX_AGE_DAYS });
        return removed;
      } catch (err) {
        log.warn("places_cache prune failed", err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    },
  };
}
