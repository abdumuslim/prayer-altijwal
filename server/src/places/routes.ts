import { Router, type Request, type Response } from "express";
import { PlacesMasjidsQuery } from "../validation/places.js";
import { searchNearbyMasjids, type Masjid } from "./google-places.js";
import { gridKey, TtlLruCache } from "./cache.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

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
