import { childLogger } from "../logger.js";
import { haversineKm } from "../util/geo-distance.js";
import { searchNearbyMasjids, type Masjid } from "./google-places.js";
import { cellCentre, cellIsUsable, gridKey, TtlLruCache, type CellCoverage } from "./cache.js";
import { estimateTravel } from "./travel-estimate.js";
import { mergeMasjids } from "./merge.js";
import type { ResidentIndex } from "./resident-index.js";
import type { CachedCell, PlacesCacheRepo } from "../db/repositories/places-cache.js";

const log = childLogger("places/masjid-service");

/**
 * In-process tier in front of Postgres. Short TTL on purpose: it exists to spare
 * the database a query on a hot cell, not to be the cache — the durable 30-day
 * copy lives in places_cache and survives deploys.
 */
const MEM_TTL_MS = 60 * 60 * 1000;
const MEM_MAX_ENTRIES = 2000;

/** How many masjids the client is given, after re-ranking by true distance. */
const MASJIDS_RETURNED = 10;

/** One masjid as served to the client. */
export interface ServedMasjid extends Masjid {
  walkMin: number | null;
  driveMin: number | null;
  /** true = free distance-based estimate; false = a real Routes lookup. */
  estimated: boolean;
}

export type MasjidSource = "resident" | "cache_mem" | "cache_db" | "live" | "degraded";

export interface MasjidLookup {
  masjids: ServedMasjid[];
  source: MasjidSource;
  degraded: boolean;
  /** Cell this lookup resolved against — recorded as anonymous demand data. */
  cellKey: string;
}

export interface MasjidServiceDeps {
  apiKey: string;
  /** Absent ⇒ memory-only (tests, or a boot where the pool is unavailable). */
  cacheRepo?: PlacesCacheRepo | undefined;
  /** Free OSM + community masjids; absent ⇒ Google is the only source. */
  resident?: ResidentIndex | undefined;
}

export interface MasjidService {
  /**
   * `spend` is passed PER CALL because it is bound to the requesting client's
   * budget, while the service (and its memory cache) is shared by everyone.
   */
  lookup(lat: number, lon: number, spend: () => Promise<boolean>): Promise<MasjidLookup>;
  memSize(): number;
}

/** Coverage a freshly fetched cell can vouch for. */
function coverageOf(centre: { lat: number; lon: number }, masjids: Masjid[]): CellCoverage {
  let maxDistKm = 0;
  for (const m of masjids) {
    const d = haversineKm(centre.lat, centre.lon, m.lat, m.lon);
    if (d > maxDistKm) maxDistKm = d;
  }
  return { resultCount: masjids.length, maxDistKm };
}

/** How far around the user the resident index is consulted. */
const RESIDENT_RADIUS_KM = 5;

/**
 * Rank by distance from the user's ACTUAL position — not the cell centre the
 * search was anchored at — and attach the free travel estimate.
 */
function rank(lat: number, lon: number, masjids: Masjid[]): ServedMasjid[] {
  return masjids
    .map((m) => ({ m, km: haversineKm(lat, lon, m.lat, m.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, MASJIDS_RETURNED)
    .map(({ m, km }) => {
      const { walkMin, driveMin } = estimateTravel(km);
      return { ...m, walkMin, driveMin, estimated: true };
    });
}

/**
 * Nearest-masjid serving order (docs/DECISIONS.md ADR-014):
 *
 *   memory cell → Postgres cell (≤30 d) → live Google → stale/degraded
 *
 * A cached cell is only served when `cellIsUsable` proves it cannot be hiding a
 * masjid nearer to this particular user; otherwise the lookup falls through to a
 * live search. Refusing to spend is never an error — it degrades to whatever
 * free answer exists, because an empty screen is worse than a slightly stale one.
 */
export function createMasjidService(deps: MasjidServiceDeps): MasjidService {
  const mem = new TtlLruCache<CachedCell>(MEM_TTL_MS, MEM_MAX_ENTRIES);

  /**
   * Everything we know about this spot: the free resident masjids unioned with
   * whatever Google content we hold, deduplicated, ranked from the user.
   *
   * Google results are merged in at SERVE time and never written into the
   * resident dataset — places_cache stays purely Google so its 30-day retention
   * means what it says.
   */
  const build = (lat: number, lon: number, google: Masjid[]): ServedMasjid[] => {
    const local = deps.resident?.nearest(lat, lon, RESIDENT_RADIUS_KM, MASJIDS_RETURNED * 2) ?? [];
    return rank(lat, lon, mergeMasjids(local, google));
  };

  return {
    async lookup(lat, lon, spend) {
      const key = gridKey(lat, lon);
      const centre = cellCentre(key);
      if (!centre) {
        // gridKey always produces a parseable key; this is belt-and-braces.
        log.warn("unparseable cell key", { key });
        return { masjids: [], source: "degraded", degraded: true, cellKey: key };
      }
      const fromCentreKm = haversineKm(lat, lon, centre.lat, centre.lon);

      // Best free answer we have seen, usable or not — the degraded fallback.
      let stale: CachedCell | null = null;

      // Cache first, so quality we have ALREADY paid for is never thrown away
      // in favour of a free-but-thinner answer.
      const hit = mem.get(key);
      if (hit) {
        if (cellIsUsable(hit, fromCentreKm)) {
          return {
            masjids: build(lat, lon, hit.masjids),
            source: "cache_mem",
            degraded: false,
            cellKey: key,
          };
        }
        stale = hit;
      }

      if (deps.cacheRepo) {
        const row = await deps.cacheRepo.get(key);
        if (row) {
          mem.set(key, row);
          if (cellIsUsable(row, fromCentreKm)) {
            return {
              masjids: build(lat, lon, row.masjids),
              source: "cache_db",
              degraded: false,
              cellKey: key,
            };
          }
          stale = row;
        }
      }

      // Nothing cached — but where the resident data is genuinely dense, it is
      // already a good answer, and buying one would add little. This is what
      // makes Google's share shrink as the community fills Iraq in.
      if (!stale && deps.resident?.isDenseAt(lat, lon)) {
        return {
          masjids: build(lat, lon, []),
          source: "resident",
          degraded: false,
          cellKey: key,
        };
      }

      if (!(await spend())) {
        return {
          masjids: build(lat, lon, stale?.masjids ?? []),
          source: "degraded",
          degraded: true,
          cellKey: key,
        };
      }

      // Anchored at the CELL CENTRE, not the caller — that is what makes the
      // resulting entry reusable by everyone else in the cell.
      const found = await searchNearbyMasjids(centre.lat, centre.lon, deps.apiKey);
      if (found === null) {
        // Upstream failure (already logged) — fall back to whatever is free, and
        // do NOT cache the failure so the next request retries.
        return {
          masjids: build(lat, lon, stale?.masjids ?? []),
          source: "degraded",
          degraded: true,
          cellKey: key,
        };
      }

      const coverage = coverageOf(centre, found);
      const cell: CachedCell = { masjids: found, ...coverage, fetchedAt: new Date() };
      mem.set(key, cell);
      void deps.cacheRepo?.put(key, { masjids: found, ...coverage });

      return { masjids: build(lat, lon, found), source: "live", degraded: false, cellKey: key };
    },

    memSize: () => mem.size,
  };
}
