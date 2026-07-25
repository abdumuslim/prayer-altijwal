/**
 * Cell geometry + the in-process tier of the masjid cache
 * (docs/QIBLA_MASJID_SPEC.md §6a, docs/DECISIONS.md ADR-014).
 *
 * Requests are keyed by grid cell so everyone in a neighbourhood shares ONE
 * upstream call. The cell was ~330 m, which barely deduplicated anything; it is
 * now ~1.1 km, and the Google search is anchored at the CELL CENTRE rather than
 * the caller's exact position — that is what makes an entry reusable by the next
 * person in the cell instead of being personal to whoever paid for it.
 *
 * Coarsening a cache normally trades away correctness. Here it does not, because
 * `cellIsUsable` refuses any entry that could hide a nearer masjid — see below.
 */

/** ≈1.1 km of latitude per step. Cell half-diagonal ≈0.72 km at Baghdad's latitude. */
export const CELL_DEG = 0.01;

/** Radius of the upstream Nearby Search, metres. */
export const SEARCH_RADIUS_M = 5000;

/**
 * Results requested per search. Raised 10 → 20: the call costs the same and the
 * extra results widen the radius an entry stays provably valid over.
 */
export const MAX_RESULTS = 20;

/**
 * How much guaranteed coverage around the USER an entry must retain to be
 * served. 1.5 km comfortably contains "the nearest few masjids" in any Iraqi
 * town, so a served entry can never be hiding a closer one.
 */
export const VALIDITY_MARGIN_KM = 1.5;

/** Quantize a coordinate pair onto an arbitrary grid. */
export function quantizeKey(lat: number, lon: number, gridDeg: number): string {
  return `${Math.round(lat / gridDeg)},${Math.round(lon / gridDeg)}`;
}

/** Grid-cell cache key for a coordinate pair. */
export function gridKey(lat: number, lon: number): string {
  return quantizeKey(lat, lon, CELL_DEG);
}

/**
 * Centre of the cell a key names — the coordinate the upstream search is
 * anchored at. Returns null for a malformed key (defensive: keys can arrive
 * from a database row, not just from gridKey).
 */
export function cellCentre(key: string): { lat: number; lon: number } | null {
  const parts = key.split(",");
  if (parts.length !== 2) return null;
  const latStep = Number(parts[0]);
  const lonStep = Number(parts[1]);
  if (!Number.isFinite(latStep) || !Number.isFinite(lonStep)) return null;
  return { lat: latStep * CELL_DEG, lon: lonStep * CELL_DEG };
}

/** What a cached cell records about the coverage it can vouch for. */
export interface CellCoverage {
  /** How many results the upstream search returned for this cell. */
  resultCount: number;
  /** Distance from the cell centre to the FARTHEST result, km. */
  maxDistKm: number;
}

/**
 * May this cached cell answer for a user `distanceFromCentreKm` away from the
 * cell centre?
 *
 * Two ways to be sure it hides nothing nearer:
 *  - The search came back UNSATURATED (fewer results than we asked for), so it
 *    enumerated everything within 5 km of the centre — and the user is at most a
 *    half-diagonal from that centre.
 *  - It saturated, but its farthest result still reaches past the user by the
 *    validity margin, so the user's own neighbourhood is fully enumerated.
 *
 * Anything else falls through to a fresh search. In practice that only happens
 * in a very dense city centre, which is exactly where a fresh call is warranted.
 */
export function cellIsUsable(coverage: CellCoverage, distanceFromCentreKm: number): boolean {
  if (!Number.isFinite(distanceFromCentreKm) || distanceFromCentreKm < 0) return false;
  if (coverage.resultCount < MAX_RESULTS) return true;
  return coverage.maxDistKm >= distanceFromCentreKm + VALIDITY_MARGIN_KM;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Insertion-ordered `Map` as LRU: `get()` refreshes recency by re-inserting,
 * `set()` evicts the least-recently-used entry past the cap. Expired entries
 * are dropped lazily on read.
 */
export class TtlLruCache<T> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string, now: number = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
