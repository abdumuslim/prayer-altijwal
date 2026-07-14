import { Router, type Request, type Response } from "express";
import { childLogger } from "../logger.js";
import { PlacesMasjidsQuery } from "../validation/places.js";
import { searchNearbyMasjids, type Masjid } from "./google-places.js";
import { gridKey, TtlLruCache } from "./cache.js";

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
 */
const UPSTREAM_MAX_PER_MIN = 30;

export interface PlacesRouterDeps {
  /** Google Places API key; undefined ⇒ the endpoint reports `enabled: false`. */
  apiKey: string | undefined;
}

/**
 * Places router: nearest-masjid proxy (docs/QIBLA_MASJID_SPEC.md §6a).
 * The key never leaves the server; the client only sees the mapped results.
 * Response contract (always 200 unless validation fails):
 *   { enabled: false, masjids: [] }                   — no key configured
 *   { enabled: true,  masjids: Masjid[] }             — served (possibly empty area)
 *   { enabled: true,  masjids: [], degraded: true }   — upstream failure, not cached
 */
export function createPlacesRouter(deps: PlacesRouterDeps): Router {
  const r = Router();
  const cache = new TtlLruCache<Masjid[]>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);

  // Rolling-minute upstream counter (per router instance). Reset lazily.
  let windowStart = 0;
  let windowCalls = 0;
  const upstreamAllowed = (now: number = Date.now()): boolean => {
    if (now - windowStart >= 60_000) {
      windowStart = now;
      windowCalls = 0;
    }
    if (windowCalls >= UPSTREAM_MAX_PER_MIN) return false;
    windowCalls += 1;
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
      res.json({ enabled: true, masjids: cached });
      return;
    }

    if (!upstreamAllowed()) {
      // Budget breaker tripped — degrade without spending; clients retry later.
      if (windowCalls === UPSTREAM_MAX_PER_MIN) {
        log.warn("places upstream budget breaker tripped", { perMinute: UPSTREAM_MAX_PER_MIN });
        windowCalls += 1; // log once per window
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
    cache.set(key, masjids);
    res.json({ enabled: true, masjids });
  });

  return r;
}
