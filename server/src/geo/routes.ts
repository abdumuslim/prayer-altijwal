import { Router, type Request, type Response } from "express";
import { detectMethod } from "../prayer/method-detect.js";
import { GeoReverseQuery, GeoSearchQuery } from "../validation/geo.js";
import { CitiesIndex, type City } from "./cities-index.js";
import { openMeteoSearch, type GeoResult } from "./open-meteo.js";

const SEARCH_LIMIT = 8;

/** Map an offline City record into the public forward-geocoding result shape. */
function cityToResult(c: City): GeoResult {
  return {
    name: c.n,
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
export function createGeoRouter(index: CitiesIndex): Router {
  const r = Router();

  r.get("/api/geo/reverse", (req: Request, res: Response) => {
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

    res.json({
      city: city.n,
      country: city.cc,
      admin1: city.adm1,
      tz: city.tz,
      elevation: city.ele,
      method,
    });
  });

  r.get("/api/geo/search", async (req: Request, res: Response) => {
    const parsed = GeoSearchQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const { q, lang } = parsed.data;

    const offline = index.search(q, SEARCH_LIMIT).map(cityToResult);
    const results =
      offline.length > 0 ? offline : (await openMeteoSearch(q, lang)).slice(0, SEARCH_LIMIT);

    res.json({ results });
  });

  return r;
}
