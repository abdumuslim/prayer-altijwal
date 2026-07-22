import { Router, type Request, type Response } from "express";
import { childLogger } from "../logger.js";
import { PlacesMasjidsQuery } from "../validation/places.js";
import { searchNearbyMasjids, type Masjid } from "./google-places.js";
import { fetchTravelMinutes } from "./google-routes.js";
import { gridKey, TtlLruCache } from "./cache.js";

/** A masjid plus its walking/driving travel time (null when Google has none). */
export interface MasjidWithTravel extends Masjid {
  walkMin: number | null;
  driveMin: number | null;
}

const log = childLogger("places/routes");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
/**
 * Global upstream budget breaker (security review 2026-07-14): the grid cache
 * bounds ORGANIC spend (real users cluster in cells), but an attacker sweeping
 * unique coordinates gets a cache miss — and a paid Google call — per request.
 * Cap live upstream calls per rolling minute server-wide; past the cap the
 * route degrades (retryable `degraded: true`) without calling Google. The
 * GCP-side daily quota on the key remains the hard billing backstop.
 *
 * Counted in UNITS, not requests: a cache miss now costs 3 upstream calls
 * (1 Places + 2 Routes — travelMode is per-request), so 30 units ≈ 10 uncached
 * lookups per minute server-wide.
 */
const UPSTREAM_MAX_PER_MIN = 30;
/** Places search + WALK matrix + DRIVE matrix. */
const UNITS_PER_MISS = 3;
/**
 * How many masjids get travel times. Routes' computeRouteMatrix is billed per
 * ELEMENT (origins × destinations), so fetching all 10 would price twice what
 * the client shows — NearestMasjids renders 5 rows (MAX_ROWS).
 */
const TRAVEL_TIME_ROWS = 5;

export interface PlacesRouterDeps {
  /** Google Places API key; undefined ⇒ the endpoint reports `enabled: false`. */
  apiKey: string | undefined;
  /**
   * Maps Embed API key, echoed to the client so an expanded masjid row can show
   * an interactive directions map. SEPARATE from `apiKey` on purpose: this one
   * is browser-visible, so it must be restricted to the Embed API (which is free
   * and unmetered) — never reuse the Places key here.
   */
  embedKey?: string | undefined;
}

/**
 * Places router: nearest-masjid proxy (docs/QIBLA_MASJID_SPEC.md §6a).
 * The key never leaves the server; the client only sees the mapped results.
 * Response contract (always 200 unless validation fails):
 *   { enabled: false, masjids: [] }                   — no key configured
 *   { enabled: true,  masjids: MasjidWithTravel[], embedKey? }
 *                                                     — served (possibly empty area)
 *   { enabled: true,  masjids: [], degraded: true }   — upstream failure, not cached
 */
export function createPlacesRouter(deps: PlacesRouterDeps): Router {
  const r = Router();
  const cache = new TtlLruCache<MasjidWithTravel[]>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);

  // Rolling-minute upstream counter (per router instance). Reset lazily.
  let windowStart = 0;
  let windowCalls = 0;
  let warned = false;
  const upstreamAllowed = (units: number, now: number = Date.now()): boolean => {
    if (now - windowStart >= 60_000) {
      windowStart = now;
      windowCalls = 0;
      warned = false;
    }
    if (windowCalls + units > UPSTREAM_MAX_PER_MIN) return false;
    windowCalls += units;
    return true;
  };

  r.get("/api/places/masjids", async (req: Request, res: Response) => {
    const parsed = PlacesMasjidsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    if (!deps.apiKey) {
      res.json({ enabled: false, masjids: [] });
      return;
    }
    const { lat, lon } = parsed.data;

    const key = gridKey(lat, lon);
    const cached = cache.get(key);
    if (cached) {
      res.json({ enabled: true, masjids: cached, embedKey: deps.embedKey });
      return;
    }

    if (!upstreamAllowed(UNITS_PER_MISS)) {
      // Budget breaker tripped — degrade without spending; clients retry later.
      if (!warned) {
        warned = true;
        log.warn("places upstream budget breaker tripped", { perMinute: UPSTREAM_MAX_PER_MIN });
      }
      res.json({ enabled: true, masjids: [], degraded: true });
      return;
    }

    const masjids = await searchNearbyMasjids(lat, lon, deps.apiKey);
    if (masjids === null) {
      // Upstream failure (already logged) — degraded, and deliberately NOT
      // cached so the next request retries.
      res.json({ enabled: true, masjids: [], degraded: true });
      return;
    }

    // Travel times are an ENHANCEMENT: if the matrix fails we still serve (and
    // cache) the list with nulls rather than spending the Places call again.
    // Routes bills PER ELEMENT (origin×destination), so only the rows the client
    // actually renders are priced — the rest keep null times.
    const priced = masjids.slice(0, TRAVEL_TIME_ROWS);
    const travel = await fetchTravelMinutes({ lat, lon }, priced, deps.apiKey);
    const withTravel: MasjidWithTravel[] = masjids.map((m, i) => ({
      ...m,
      walkMin: travel?.[i]?.walkMin ?? null,
      driveMin: travel?.[i]?.driveMin ?? null,
    }));

    cache.set(key, withTravel);
    res.json({ enabled: true, masjids: withTravel, embedKey: deps.embedKey });
  });

  return r;
}
