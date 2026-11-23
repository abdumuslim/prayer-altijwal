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
  /**
   * Google-only mode: when Google returned the cell the list was built from (the
   * watch counts its 30-day offline limit from it). Absent in the default mode,
   * and when no Google cell was served.
   */
  fetchedAt?: Date;
}

export interface MasjidServiceDeps {
  apiKey: string;
  /** Absent ⇒ memory-only (tests, or a boot where the pool is unavailable). */
  cacheRepo?: PlacesCacheRepo | undefined;
  /** Free OSM + community masjids; absent ⇒ Google is the only source. */
  resident?: ResidentIndex | undefined;
}

export interface MasjidLookupOptions {
  /**
   * Serve Google results plus the approved community masjids near the user (never
   * the bundled OSM base), and no "resident is dense" short-cut. Reads the shared cell first (Google data already paid for),
   * then its own `g:` cell; writes ONLY the `g:` cell, so this traffic can never
   * leave the default path an unusable shared cell to re-buy (see lookup).
   */
  googleOnly?: boolean | undefined;
}

export interface MasjidService {
  /**
   * `spend` is passed PER CALL because it is bound to the requesting client's
   * budget, while the service (and its memory cache) is shared by everyone.
   */
  lookup(
    lat: number,
    lon: number,
    spend: () => Promise<boolean>,
    opts?: MasjidLookupOptions,
  ): Promise<MasjidLookup>;
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

/** Namespace prefix of the cells Google-only lookups write (memory and places_cache). */
const GOOGLE_ONLY_PREFIX = "g:";

/**
 * In Google-only mode a cell fetched this recently is served even when
 * `cellIsUsable` refuses it: a re-search is anchored at the same cell centre and
 * would return the same set, so spending again cannot widen it.
 */
const GOOGLE_ONLY_GRACE_MS = 24 * 60 * 60 * 1000;

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
   * means what it says. In Google-only mode only the approved community masjids
   * are read (never the bundled OSM base): they cover real masjids Google files
   * under another category, and only when a Google cell is being served. They are
   * added at serve time too, so they never reach the g: cache cells.
   */
  const build = (
    lat: number,
    lon: number,
    google: Masjid[],
    googleOnly: boolean,
  ): ServedMasjid[] => {
    if (googleOnly) {
      const added =
        deps.resident?.nearestCommunity(lat, lon, RESIDENT_RADIUS_KM, MASJIDS_RETURNED * 2) ?? [];
      // No community row near: Google's own list, untouched (no dedupe among
      // Google's places), exactly as before community rows existed.
      if (added.length === 0) return rank(lat, lon, google);
      return rank(lat, lon, mergeMasjids(added, google));
    }
    const local = deps.resident?.nearest(lat, lon, RESIDENT_RADIUS_KM, MASJIDS_RETURNED * 2) ?? [];
    return rank(lat, lon, mergeMasjids(local, google));
  };

  return {
    async lookup(lat, lon, spend, opts) {
      const googleOnly = opts?.googleOnly === true;
      const key = gridKey(lat, lon);
      const centre = cellCentre(key);
      if (!centre) {
        // gridKey always produces a parseable key; this is belt-and-braces.
        log.warn("unparseable cell key", { key });
        return { masjids: [], source: "degraded", degraded: true, cellKey: key };
      }
      const fromCentreKm = haversineKm(lat, lon, centre.lat, centre.lon);

      // The default path reads and writes only the shared grid key. Google-only
      // reads the shared key first, then its own namespace, and writes only its
      // own namespace: a Google-only purchase in a dense-resident cell must never
      // become a shared cell the default path finds unusable and re-buys.
      const ownKey = googleOnly ? GOOGLE_ONLY_PREFIX + key : key;
      const readKeys = googleOnly ? [key, ownKey] : [key];
      const servable = (cell: CachedCell): boolean =>
        cellIsUsable(cell, fromCentreKm) ||
        (googleOnly && Date.now() - cell.fetchedAt.getTime() < GOOGLE_ONLY_GRACE_MS);
      const served = (
        cell: CachedCell | null,
        source: MasjidSource,
        degraded: boolean,
      ): MasjidLookup => {
        // Google-only with NO Google cell (live, cached or stale): stay empty. The
        // watch reads [] as "use my saved list", whereas a community-only reply
        // would overwrite that saved offline list. Community rows join only when
        // a Google cell is served (an empty Google cell that exists counts).
        const result: MasjidLookup = {
          masjids: googleOnly && !cell ? [] : build(lat, lon, cell?.masjids ?? [], googleOnly),
          source,
          degraded,
          cellKey: key,
        };
        if (googleOnly && cell) result.fetchedAt = cell.fetchedAt;
        return result;
      };

      // Best free answer we have seen, usable or not — the degraded fallback.
      // Of several, the most recently fetched.
      let stale: CachedCell | null = null;
      const noteStale = (cell: CachedCell): void => {
        if (!stale || cell.fetchedAt.getTime() > stale.fetchedAt.getTime()) stale = cell;
      };

      // Cache first, so quality we have ALREADY paid for is never thrown away
      // in favour of a free-but-thinner answer.
      for (const k of readKeys) {
        const hit = mem.get(k);
        if (!hit) continue;
        if (servable(hit)) return served(hit, "cache_mem", false);
        noteStale(hit);
      }

      if (deps.cacheRepo) {
        for (const k of readKeys) {
          const row = await deps.cacheRepo.get(k);
          if (!row) continue;
          mem.set(k, row);
          if (servable(row)) return served(row, "cache_db", false);
          noteStale(row);
        }
      }

      // Nothing cached — but where the resident data is genuinely dense, it is
      // already a good answer, and buying one would add little. This is what
      // makes Google's share shrink as the community fills Iraq in. A Google-only
      // caller has asked for Google's data, so it goes on to the live search.
      if (!googleOnly && !stale && deps.resident?.isDenseAt(lat, lon)) {
        return {
          masjids: build(lat, lon, [], false),
          source: "resident",
          degraded: false,
          cellKey: key,
        };
      }

      if (!(await spend())) return served(stale, "degraded", true);

      // Anchored at the CELL CENTRE, not the caller — that is what makes the
      // resulting entry reusable by everyone else in the cell.
      const found = await searchNearbyMasjids(centre.lat, centre.lon, deps.apiKey);
      if (found === null) {
        // Upstream failure (already logged) — fall back to whatever is free, and
        // do NOT cache the failure so the next request retries.
        return served(stale, "degraded", true);
      }

      const coverage = coverageOf(centre, found);
      const cell: CachedCell = { masjids: found, ...coverage, fetchedAt: new Date() };
      mem.set(ownKey, cell);
      void deps.cacheRepo?.put(ownKey, { masjids: found, ...coverage });

      return served(cell, "live", false);
    },

    memSize: () => mem.size,
  };
}
