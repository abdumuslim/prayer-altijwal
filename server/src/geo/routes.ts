import { Router, type Request, type Response } from "express";
import { detectMethod } from "../prayer/method-detect.js";
import { childLogger } from "../logger.js";
import {
  GeoDeclinationQuery,
  GeoGovernoratesQuery,
  GeoReverseQuery,
  GeoSearchQuery,
} from "../validation/geo.js";
import { CitiesIndex, type City } from "./cities-index.js";
import { declinationDeg } from "./declination.js";
import { openMeteoSearch, type GeoResult } from "./open-meteo.js";
import { clientIpOf, ipPrefix } from "../places/identity.js";
import { createSlidingLimiter } from "../http/rate-limit.js";

const log = childLogger("geo/routes");

const SEARCH_LIMIT = 8;
/** Cap the governorate quick-pick; covers every country's admin-1 divisions. */
const GOVERNORATE_LIMIT = 40;

const MINUTE_MS = 60 * 1000;
/** Autocomplete is client-debounced, so a real typing user stays well under
 *  this; it only bounds a scripted flood. */
const SEARCH_PER_IP_PER_MIN = 120;
const SEARCH_GLOBAL_PER_MIN = 3000;
/** reverse + declination are one-shot lookups per location change. */
const LOOKUP_PER_IP_PER_MIN = 60;
const LOOKUP_GLOBAL_PER_MIN = 2000;

/**
 * Edge/browser cache for a SUCCESSFUL lookup. app.ts defaults every /api/*
 * response to no-store ahead of routing; a 200 opts back in by setting this
 * right before res.json, so a 400/404 never inherits it. reverse / search /
 * declination / governorates are pure functions of their query params over the
 * bundled offline dataset (cities + declination model), with no now-relative
 * content → cacheable for hours.
 */
const PUBLIC_CACHE_CONTROL = "public, max-age=21600";

export interface GeoRouterDeps {
  /** Overridable so the read caps can be exercised without flooding a test. */
  searchLimits?: { perIpPerMinute?: number; globalPerMinute?: number };
  /** Shared by /reverse + /declination (both cheap dataset lookups). */
  lookupLimits?: { perIpPerMinute?: number; globalPerMinute?: number };
}

/** Map an offline City record into the public forward-geocoding result shape. */
function cityToResult(c: City): GeoResult {
  return {
    name: c.n,
    nameAr: c.nar ?? null,
    country: c.cc,
    admin1: c.adm1,
    tz: c.tz,
    lat: c.lat,
    lon: c.lon,
    elevation: c.ele,
    population: c.pop,
  };
}

/** Geo router: GPS reverse-lookup + forward city search (offline-first). */
export function createGeoRouter(index: CitiesIndex, deps: GeoRouterDeps = {}): Router {
  const r = Router();

  // Per-IP-prefix + global limiters, same hand-rolled idiom as the push router.
  const searchLimiter = createSlidingLimiter({
    windowMs: MINUTE_MS,
    perKey: deps.searchLimits?.perIpPerMinute ?? SEARCH_PER_IP_PER_MIN,
    globalPerWindow: deps.searchLimits?.globalPerMinute ?? SEARCH_GLOBAL_PER_MIN,
    onGlobalTrip: () => log.warn("geo search global rate cap reached; requests dropped this minute"),
  });
  const lookupLimiter = createSlidingLimiter({
    windowMs: MINUTE_MS,
    perKey: deps.lookupLimits?.perIpPerMinute ?? LOOKUP_PER_IP_PER_MIN,
    globalPerWindow: deps.lookupLimits?.globalPerMinute ?? LOOKUP_GLOBAL_PER_MIN,
    onGlobalTrip: () => log.warn("geo lookup global rate cap reached; requests dropped this minute"),
  });

  /** Guard a route with a limiter. Responds 429 and returns false when over. */
  function allowed(limiter: ReturnType<typeof createSlidingLimiter>, req: Request, res: Response): boolean {
    if (limiter.allow(ipPrefix(clientIpOf(req)))) return true;
    res.status(429).json({ error: "Too many requests" });
    return false;
  }

  r.get("/api/geo/reverse", (req: Request, res: Response) => {
    if (!allowed(lookupLimiter, req, res)) return;
    const parsed = GeoReverseQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const { lat, lon } = parsed.data;

    const city = index.reverse(lat, lon);
    if (!city) {
      res.status(404).json({ error: "No city found for the given coordinates" });
      return;
    }

    // Method detection uses the REQUEST coords (Baghdad-radius rule), not the
    // city centroid — a GPS fix just outside Baghdad must not pick BaghdadYMA.
    const method = detectMethod(city.cc, lat, lon).key;

    res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
    res.json({
      city: city.n,
      cityAr: city.nar ?? null,
      country: city.cc,
      admin1: city.adm1,
      tz: city.tz,
      elevation: city.ele,
      method,
    });
  });

  r.get("/api/geo/search", async (req: Request, res: Response) => {
    if (!allowed(searchLimiter, req, res)) return;
    const parsed = GeoSearchQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const { q, lang } = parsed.data;

    const offline = index.search(q, SEARCH_LIMIT).map(cityToResult);
    const results =
      offline.length > 0 ? offline : (await openMeteoSearch(q, lang)).slice(0, SEARCH_LIMIT);

    res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
    res.json({ results });
  });

  // Magnetic declination (WMM) for the web compass paths — the native app uses
  // Android's GeomagneticField instead (docs/QIBLA_MASJID_SPEC.md §5c).
  r.get("/api/geo/declination", (req: Request, res: Response) => {
    if (!allowed(lookupLimiter, req, res)) return;
    const parsed = GeoDeclinationQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const { lat, lon } = parsed.data;
    res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
    res.json({ declinationDeg: Math.round(declinationDeg(lat, lon) * 100) / 100 });
  });

  // A country's governorates (admin-1 capitals) — the location quick-pick that
  // replaced the manual method override. Offline-only (no external call).
  r.get("/api/geo/governorates", (req: Request, res: Response) => {
    const parsed = GeoGovernoratesQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const governorates = index
      .governorates(parsed.data.country)
      .slice(0, GOVERNORATE_LIMIT)
      .map(cityToResult);
    res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
    res.json({ governorates });
  });

  return r;
}
