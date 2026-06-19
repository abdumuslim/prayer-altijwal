import { childLogger } from "../logger.js";

const log = childLogger("geo/open-meteo");

const ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEOUT_MS = 3000;
const COUNT = 8;

/**
 * Normalised forward-geocoding candidate. Both the offline `CitiesIndex` and the
 * Open-Meteo fallback map into this shape so routes can treat them uniformly.
 */
export interface GeoResult {
  name: string;
  country: string;
  admin1: string;
  tz: string;
  lat: number;
  lon: number;
  elevation: number | null;
  population: number;
}

/** Shape of a single Open-Meteo geocoding result (only the fields we use). */
interface OpenMeteoResult {
  name?: unknown;
  country_code?: unknown;
  admin1?: unknown;
  timezone?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  elevation?: unknown;
  population?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function mapResult(r: OpenMeteoResult): GeoResult {
  return {
    name: str(r.name),
    country: str(r.country_code),
    admin1: str(r.admin1),
    tz: str(r.timezone),
    lat: num(r.latitude),
    lon: num(r.longitude),
    elevation: typeof r.elevation === "number" && Number.isFinite(r.elevation) ? r.elevation : null,
    population: num(r.population),
  };
}

/**
 * Online forward-geocoding fallback via Open-Meteo (free, no API key).
 * Never throws: on any error (network, timeout, bad JSON) it returns [].
 */
export async function openMeteoSearch(q: string, lang: "ar" | "en"): Promise<GeoResult[]> {
  const query = q.trim();
  if (query === "") return [];

  const url = `${ENDPOINT}?name=${encodeURIComponent(query)}&count=${COUNT}&language=${lang}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      log.warn("open-meteo non-ok response", { status: res.status });
      return [];
    }
    const body = (await res.json()) as { results?: OpenMeteoResult[] };
    if (!Array.isArray(body.results)) return [];
    return body.results.map(mapResult).filter((r) => r.name !== "");
  } catch (err) {
    log.warn("open-meteo search failed", err instanceof Error ? err : new Error(String(err)));
    return [];
  } finally {
    clearTimeout(timer);
  }
}
