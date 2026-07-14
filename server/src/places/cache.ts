/**
 * Tiny TTL + LRU cache for the Places proxy (docs/QIBLA_MASJID_SPEC.md §6a).
 * Requests are keyed by their ~300 m grid cell so nearby users share one
 * upstream call — with the LRU cap this bounds the worst-case Places spend.
 */

/** ≈ 333 m of latitude per step — the spec's "~300 m grid". */
const GRID_DEG = 0.003;

/** Grid-cell cache key for a coordinate pair. */
export function gridKey(lat: number, lon: number): string {
  return `${Math.round(lat / GRID_DEG)},${Math.round(lon / GRID_DEG)}`;
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

  get size(): number {
    return this.entries.size;
  }
}
