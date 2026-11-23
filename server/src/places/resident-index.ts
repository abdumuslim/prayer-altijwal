import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { childLogger } from "../logger.js";
import { haversineKm } from "../util/geo-distance.js";
import { isExcludedVenue } from "./venue-filter.js";
import type { Masjid } from "./google-places.js";

const log = childLogger("places/resident-index");

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(here, "../../data/masjids-iq.json");

/** Compact row as written by scripts/build-masjids.mjs. */
interface RawRow {
  n: string;
  lat: number;
  lon: number;
  oid: string;
}

/** Latitude band width for the bucket index (1° ≈ 111 km). */
const BAND_DEG = 1;
const KM_PER_DEG_LAT = 111;

/**
 * Masjids we are allowed to keep — OpenStreetMap (ODbL) plus this app's own
 * users' contributions (ADR-014).
 *
 * This is the free floor under the nearest-masjid feature: it answers with no
 * network, with no budget, and with no Google call. Google content can never
 * live here — its terms cap caching at 30 days, which is why the durable copy
 * had to come from a source licensed for it.
 *
 * Structured like geo/cities-index.ts (load once at boot, bucket by latitude
 * band, haversine within the candidate bands) and reuses the SAME haversineKm
 * helper — there is deliberately only one distance function in this codebase.
 */
export class ResidentIndex {
  private bands = new Map<number, Masjid[]>();
  /** The same band index over the community rows alone. */
  private communityBands = new Map<number, Masjid[]>();
  private base: Masjid[] = [];
  private community: Masjid[] = [];

  private constructor(base: Masjid[]) {
    this.base = base;
    this.reindex();
  }

  /** Build from the bundled dataset. A missing file is not fatal — the feature
   *  simply has no resident floor and leans on Google, exactly as before. */
  static load(file: string = DEFAULT_FILE): ResidentIndex {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RawRow[];
      const rows = ResidentIndex.mapRows(raw);
      log.info("loaded resident masjid index", { count: rows.length, file });
      return new ResidentIndex(rows);
    } catch (err) {
      log.warn(
        "resident masjid dataset unavailable — falling back to Google only",
        err instanceof Error ? err : new Error(String(err)),
      );
      return new ResidentIndex([]);
    }
  }

  /** Build from rows in memory (tests). */
  static fromRows(rows: RawRow[]): ResidentIndex {
    return new ResidentIndex(ResidentIndex.mapRows(rows));
  }

  private static mapRows(raw: unknown): Masjid[] {
    if (!Array.isArray(raw)) return [];
    const out: Masjid[] = [];
    for (const r of raw as RawRow[]) {
      if (typeof r?.n !== "string") continue;
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
      // The SAME exclusion the Google path applies, deliberately at load time
      // rather than in the build script: one filter, one source of truth, so the
      // two datasets cannot disagree about what counts as a masjid.
      if (isExcludedVenue(r.n)) continue;
      out.push({
        id: `osm:${r.oid}`,
        name: r.n,
        lat: r.lat,
        lon: r.lon,
        address: null,
      });
    }
    return out;
  }

  /** Replace the community-contributed layer (approved rows from Postgres). */
  setCommunity(rows: Masjid[]): void {
    this.community = rows;
    this.reindex();
  }

  private reindex(): void {
    this.bands = ResidentIndex.bucket([...this.base, ...this.community]);
    this.communityBands = ResidentIndex.bucket(this.community);
  }

  private static bucket(rows: Masjid[]): Map<number, Masjid[]> {
    const bands = new Map<number, Masjid[]>();
    for (const m of rows) {
      const band = Math.floor(m.lat / BAND_DEG);
      const bucket = bands.get(band);
      if (bucket) bucket.push(m);
      else bands.set(band, [m]);
    }
    return bands;
  }

  get size(): number {
    return this.base.length + this.community.length;
  }

  /** Nearest masjids within `radiusKm`, closest first. */
  nearest(lat: number, lon: number, radiusKm: number, limit: number): Masjid[] {
    return this.search(this.bands, lat, lon, radiusKm, limit);
  }

  /**
   * Like `nearest`, but only the approved community rows, never the bundled OSM
   * base. The Google-only list adds these to Google's results.
   */
  nearestCommunity(lat: number, lon: number, radiusKm: number, limit: number): Masjid[] {
    return this.search(this.communityBands, lat, lon, radiusKm, limit);
  }

  private search(
    bands: Map<number, Masjid[]>,
    lat: number,
    lon: number,
    radiusKm: number,
    limit: number,
  ): Masjid[] {
    if (bands.size === 0) return [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

    const span = Math.max(1, Math.ceil(radiusKm / KM_PER_DEG_LAT));
    const centreBand = Math.floor(lat / BAND_DEG);

    const scored: Array<{ m: Masjid; km: number }> = [];
    for (let b = centreBand - span; b <= centreBand + span; b++) {
      const bucket = bands.get(b);
      if (!bucket) continue;
      for (const m of bucket) {
        const km = haversineKm(lat, lon, m.lat, m.lon);
        if (km <= radiusKm) scored.push({ m, km });
      }
    }

    scored.sort((a, b) => a.km - b.km);
    return scored.slice(0, limit).map((s) => s.m);
  }

  /**
   * Is the resident data dense enough here to answer on its own?
   *
   * Iraqi towns have masjids every few hundred metres, so "one within a
   * kilometre and three within two" means the local mapping is real rather than
   * a lone stray point — and a Google call would buy little. Anywhere sparser
   * (a gap in OSM, or genuinely rural) still goes upstream.
   */
  isDenseAt(lat: number, lon: number): boolean {
    const near = this.nearest(lat, lon, 2, 3);
    if (near.length < 3) return false;
    return haversineKm(lat, lon, near[0]!.lat, near[0]!.lon) <= 1;
  }
}
