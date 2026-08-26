/**
 * A small in-memory sliding-window rate limiter — the same hand-rolled idiom the
 * telemetry router and admin login throttle already use, extracted so the push
 * write routes and the masjid-contribution IP cap don't each reimplement it.
 *
 * Per-key window: a key gets `perKey` hits per any rolling `windowMs`. It is a
 * true sliding window (a per-key log of hit timestamps, pruned on access), not a
 * fixed window: a fixed window lets a caller fire perKey at the tail of one
 * window and perKey more at the head of the next, ~2× the intended rate across
 * the boundary. An optional global ceiling across ALL keys mirrors the
 * telemetry/admin backstop — `clientIpOf` trusts forgeable cf-connecting-ip /
 * x-forwarded-for headers, so a per-key limit bounds nothing on its own against
 * someone reaching the origin IP directly and rotating the key every request.
 *
 * Eviction is LRU: an accessed key is refreshed to the newest position, so a key
 * that is still receiving traffic is never evicted (and thereby reset) while an
 * idle one remains (a FIFO cap could drop an active key mid-window).
 *
 * State is per-process and per-limiter-instance; a restart resets it, which is
 * not an attack path here — the windows are short and the DB-backed caps behind
 * these (the atomic contribution cap, the alert-rule count) are the durable bound.
 */

export interface SlidingLimiterOptions {
  /** Rolling window length in ms. */
  windowMs: number;
  /** Hits allowed per key within a window. */
  perKey: number;
  /** Ceiling across ALL keys in a window; omit for a per-key-only limiter. */
  globalPerWindow?: number;
  /** LRU cap on tracked keys so the map can't grow without bound. */
  maxKeys?: number;
  /** Injectable clock (tests advance it instead of sleeping). */
  now?: () => number;
  /** Called once per window the first time the global ceiling is hit. */
  onGlobalTrip?: () => void;
}

export interface SlidingLimiter {
  /** Record a hit for `key`; false ⇒ over a per-key or global cap this window. */
  allow(key: string): boolean;
  /** Tracked-key count — for introspection and tests. */
  size(): number;
}

const DEFAULT_MAX_KEYS = 5000;

/** Drop the leading (oldest) timestamps that have aged out of the window. Hits
 *  are appended in time order, so the stale ones are always a prefix. */
function pruneAged(hits: number[], cutoff: number): void {
  let i = 0;
  while (i < hits.length && hits[i] <= cutoff) i += 1;
  if (i > 0) hits.splice(0, i);
}

export function createSlidingLimiter(opts: SlidingLimiterOptions): SlidingLimiter {
  const { windowMs, perKey, globalPerWindow } = opts;
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  const now = opts.now ?? Date.now;

  // Per-key log of hit timestamps within the trailing window. Map insertion
  // order is recency order (an accessed key is re-inserted at the tail), so the
  // first key is the least-recently used and is the one evicted past maxKeys.
  const seen = new Map<string, number[]>();
  // Global hit log across ALL keys: a sliding window too, bounded in length by
  // globalPerWindow because we stop appending once the ceiling is reached.
  const globalHits: number[] = [];
  let globalWarned = false;

  return {
    allow(key) {
      const t = now();
      const cutoff = t - windowMs;

      // Global ceiling first — the bound an attacker cannot sidestep by forging
      // a different forwarded-IP header on every request.
      if (globalPerWindow !== undefined) {
        pruneAged(globalHits, cutoff);
        if (globalHits.length >= globalPerWindow) {
          if (!globalWarned) {
            globalWarned = true; // once per overload episode, not once per request
            opts.onGlobalTrip?.();
          }
          return false;
        }
        globalHits.push(t);
        globalWarned = false; // capacity is available again
      }

      const hits = seen.get(key);
      if (hits === undefined) {
        seen.set(key, [t]);
        if (seen.size > maxKeys) {
          const oldest = seen.keys().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
        return true;
      }

      // Existing key: prune the aged hits, then refresh its LRU position so an
      // active key is never the one evicted above.
      pruneAged(hits, cutoff);
      seen.delete(key);
      seen.set(key, hits);
      if (hits.length >= perKey) return false;
      hits.push(t);
      return true;
    },

    size() {
      return seen.size;
    },
  };
}
