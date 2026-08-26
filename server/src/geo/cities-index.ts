import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { haversineKm } from "../util/geo-distance.js";
import { IQ_GOVERNORATE_CAPITALS } from "./iq-governorates.js";
import { childLogger } from "../logger.js";

const log = childLogger("geo/cities-index");

/**
 * One city from the bundled GeoNames `cities15000` dataset.
 * Field names mirror the compact JSON keys produced by scripts/build-cities.mjs.
 */
export interface City {
  /** Display name (may be non-ASCII / Arabic). */
  n: string;
  /** ASCII transliteration. */
  a: string;
  lat: number;
  lon: number;
  /** ISO-3166 alpha-2 country code. */
  cc: string;
  /** First-level admin division code. */
  adm1: string;
  /** Population. */
  pop: number;
  /** IANA timezone id. */
  tz: string;
  /** Elevation (or DEM) in metres; null if unknown. */
  ele: number | null;
  /** Comma-joined Latin-script alternate names (optional). */
  alt?: string;
  /** Arabic-script name, e.g. "بغداد" (optional; absent → fall back to n/a). */
  nar?: string;
}

/** Number of integer-latitude bands searched on each side for reverse lookup. */
const BAND_SEARCH_RADIUS = 2;

/** Default dataset path, resolved relative to THIS module. */
function defaultJsonPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Works in dev (src/geo) and compiled (dist/geo): Docker copies data to /app/data.
  return path.resolve(here, "../../data/cities15000.json");
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * The normalized haystack search matches a query against: display name,
 * asciiname, and the Latin + Arabic alternate names, newline-joined so a match
 * at a field boundary still counts as a prefix. Computed once per city at load.
 */
function searchKey(c: City): string {
  const parts = [c.n, c.a];
  if (c.alt) parts.push(c.alt);
  if (c.nar) parts.push(c.nar); // lets Arabic-script queries match
  return normalize(parts.join("\n"));
}

/**
 * In-memory index over the GeoNames `cities15000` dataset.
 * - reverse: nearest city by great-circle distance (lat-band bucketed).
 * - search: diacritic-/case-insensitive prefix/substring match, ranked by pop.
 */
/** A city paired with its normalized haystack, precomputed once at load. */
interface SearchRow {
  city: City;
  /** normalize(n \n a [\n alt] [\n nar]): the same string search matched before. */
  key: string;
}

export class CitiesIndex {
  private readonly cities: readonly City[];
  /** Map<floor(lat), City[]> for bounded reverse-lookup scans. */
  private readonly bands: ReadonlyMap<number, readonly City[]>;
  /** Each city's normalized search haystack, built once so search() only
   *  normalizes the QUERY rather than every record on every request. */
  private readonly searchRows: readonly SearchRow[];

  private constructor(cities: readonly City[]) {
    this.cities = cities;
    const bands = new Map<number, City[]>();
    for (const c of cities) {
      const key = Math.floor(c.lat);
      const bucket = bands.get(key);
      if (bucket) {
        bucket.push(c);
      } else {
        bands.set(key, [c]);
      }
    }
    this.bands = bands;
    this.searchRows = cities.map((c) => ({ city: c, key: searchKey(c) }));
  }

  /** Load the dataset once from disk. */
  static load(jsonPath?: string): CitiesIndex {
    const file = jsonPath ?? defaultJsonPath();
    const raw = readFileSync(file, "utf8");
    const cities = JSON.parse(raw) as City[];
    log.info("loaded cities index", { count: cities.length, file });
    return new CitiesIndex(cities);
  }

  get size(): number {
    return this.cities.length;
  }

  /** Nearest city to the given coordinates, or null if the dataset is empty. */
  reverse(lat: number, lon: number): City | null {
    const center = Math.floor(lat);
    let best: City | null = null;
    let bestKm = Infinity;

    for (let d = -BAND_SEARCH_RADIUS; d <= BAND_SEARCH_RADIUS; d++) {
      const bucket = this.bands.get(center + d);
      if (!bucket) continue;
      for (const c of bucket) {
        const km = haversineKm(lat, lon, c.lat, c.lon);
        if (km < bestKm) {
          bestKm = km;
          best = c;
        }
      }
    }

    // Sparse-region fallback: nothing in the ±band window — scan everything.
    if (best === null) {
      for (const c of this.cities) {
        const km = haversineKm(lat, lon, c.lat, c.lon);
        if (km < bestKm) {
          bestKm = km;
          best = c;
        }
      }
    }

    return best;
  }

  /**
   * Diacritic- and case-insensitive prefix/substring search over name,
   * asciiname and Latin alternate names. Prefix matches rank above substring
   * matches; within each tier, higher population wins.
   */
  search(q: string, limit = 8): City[] {
    const needle = normalize(q.trim());
    if (needle === "") return [];

    const matches: Array<{ city: City; rank: number }> = [];
    for (const { city, key } of this.searchRows) {
      const idx = key.indexOf(needle);
      if (idx === -1) continue;
      // rank 0 = match at a token start (prefix), rank 1 = mid-string substring.
      const prefix = idx === 0 || key[idx - 1] === "\n" || key[idx - 1] === " ";
      matches.push({ city, rank: prefix ? 0 : 1 });
    }

    matches.sort((x, y) => {
      if (x.rank !== y.rank) return x.rank - y.rank;
      return y.city.pop - x.city.pop;
    });

    return matches.slice(0, limit).map((m) => m.city);
  }

  /**
   * One representative city — the most populous — per first-level admin division
   * of a country. For Iraq this yields the governorate capitals (Baghdad, Basra,
   * Mosul, …), used by the location quick-pick that replaced the method override.
   * Sorted by population (largest first).
   *
   * Iraq is served by a CURATED capitals table (`iq-governorates.ts`) instead of
   * the heuristic: the generic max-pop rule surfaced wrong/ugly names (Mosul/Basra
   * "new/old" districts, Khanaqin over Baqubah) and the unwanted Halabja. Every
   * other country still uses the heuristic below.
   */
  governorates(cc: string): City[] {
    const upper = cc.toUpperCase();
    if (upper === "IQ") {
      return [...IQ_GOVERNORATE_CAPITALS].sort((a, b) => b.pop - a.pop);
    }
    const best = new Map<string, City>();
    for (const c of this.cities) {
      if (c.cc.toUpperCase() !== upper || !c.adm1) continue;
      const cur = best.get(c.adm1);
      if (!cur || c.pop > cur.pop) best.set(c.adm1, c);
    }
    return [...best.values()].sort((a, b) => b.pop - a.pop);
  }
}
