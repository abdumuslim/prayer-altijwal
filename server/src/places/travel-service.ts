import { childLogger } from "../logger.js";
import { fetchTravelMinutes, type TravelMinutes } from "./google-routes.js";
import { quantizeKey, TtlLruCache } from "./cache.js";

const log = childLogger("places/travel");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Generous: entries are tiny (two numbers) and every hit is 2 saved elements.
 * Sized for "every masjid any user expanded in the last day", not per cell.
 */
const CACHE_MAX_ENTRIES = 5000;

/**
 * Units charged against the rolling breaker: computeRouteMatrix bills per
 * element, and travelMode is per REQUEST, so one destination × two modes = 2.
 */
export const UNITS_PER_TRAVEL_LOOKUP = 2;

/** Result of an on-expand travel lookup; nulls mean "Google has no route". */
export type TravelResult = TravelMinutes;

/**
 * Origin precision for travel times — deliberately FINER than the masjid cell
 * (`CELL_DEG`, ~1.1 km). A masjid list is the same for everyone in a
 * neighbourhood, but a walking time is not: 1 km of origin error is ~12 minutes
 * on foot, so travel keys quantize at ~330 m.
 */
const TRAVEL_ORIGIN_DEG = 0.003;

/**
 * Cache key: the origin at ~330 m (walking time doesn't turn on which side of
 * the street you stand), the destination at full precision since it is an exact
 * masjid.
 */
export function travelKey(lat: number, lon: number, dlat: number, dlon: number): string {
  return `${quantizeKey(lat, lon, TRAVEL_ORIGIN_DEG)}|${dlat.toFixed(5)},${dlon.toFixed(5)}`;
}

export interface TravelService {
  /**
   * Real walk/drive minutes for one destination. Returns `null` when the caller
   * must fall back to the client-side estimate (upstream failure or timeout).
   * `spend` gates the paid call — it is NOT consulted on a cache hit.
   */
  lookup(
    origin: { lat: number; lon: number },
    dest: { lat: number; lon: number },
    spend: () => Promise<boolean>,
  ): Promise<TravelResult | null>;
  /** Cache entry count (telemetry/tests). */
  size(): number;
}

/**
 * On-expand travel times (docs/DECISIONS.md ADR-014).
 *
 * The masjid list itself shows a free estimate; a real Routes call is spent only
 * when a user opens a row, and the answer is cached so re-opening the same row —
 * or another user opening the same masjid from the same neighbourhood — is free.
 */
export function createTravelService(apiKey: string): TravelService {
  const cache = new TtlLruCache<TravelResult>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);

  return {
    async lookup(origin, dest, spend) {
      const key = travelKey(origin.lat, origin.lon, dest.lat, dest.lon);
      const hit = cache.get(key);
      if (hit) return hit;

      if (!(await spend())) return null;

      const rows = await fetchTravelMinutes(origin, [dest], apiKey);
      const row = rows?.[0];
      if (!row) {
        // Deliberately NOT cached — the next expand should retry rather than
        // pin a failure for 24 h.
        log.warn("travel lookup failed", { key });
        return null;
      }
      cache.set(key, row);
      return row;
    },
    size: () => cache.size,
  };
}
