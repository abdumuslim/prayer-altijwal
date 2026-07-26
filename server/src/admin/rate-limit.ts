/**
 * Login throttling for the admin dashboard — pure, clock-injected, in-memory.
 *
 * Two layers, because neither is sufficient alone:
 *
 *   Per-key: 5 failures in 15 minutes locks that caller out, doubling on each
 *     repeat. Keyed by IP /24 (or /64) prefix.
 *
 *   Global: `clientIpOf` reads cf-connecting-ip / x-forwarded-for, and anyone
 *     reaching the origin IP directly can forge those headers — so per-key
 *     limits bound nothing on their own. 50 failures in 15 minutes across ALL
 *     keys therefore locks logins entirely.
 *
 * The global lock would otherwise hand an attacker a cheap denial-of-service
 * against the operator, so a key that has logged in successfully is remembered
 * for 30 days and bypasses the global lock (never its own).
 *
 * State is per-process and resets on restart: a restart is not an attack path
 * here, since the password itself is unchanged and the ceiling is short.
 */

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS = 5;
export const BASE_LOCK_MS = 15 * 60 * 1000;
export const MAX_LOCK_MS = 24 * 60 * 60 * 1000;

export const GLOBAL_WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_MAX_FAILS = 50;
export const GLOBAL_LOCK_MS = 15 * 60 * 1000;

/** Entries idle longer than this are dropped (which also resets their lock level). */
export const IDLE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_KEYS = 1000;
export const MAX_TRUSTED_KEYS = 50;
export const TRUSTED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ThrottleDecision {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
  /** Why the attempt was refused — for the audit trail, never for the client. */
  readonly reason?: "key" | "global";
}

export interface ThrottleStats {
  readonly keys: number;
  readonly trusted: number;
  readonly globalLocked: boolean;
}

export interface LoginThrottle {
  check(key: string, nowMs: number): ThrottleDecision;
  recordFailure(key: string, nowMs: number): void;
  recordSuccess(key: string, nowMs: number): void;
  stats(nowMs?: number): ThrottleStats;
}

interface Entry {
  fails: number;
  windowStart: number;
  lockedUntil: number;
  lockLevel: number;
  lastSeen: number;
}

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSec: 0 };

export function createLoginThrottle(): LoginThrottle {
  // Insertion order doubles as LRU order: every touch re-inserts the key.
  const keys = new Map<string, Entry>();
  const trusted = new Map<string, number>();
  let globalFails = 0;
  let globalWindowStart = 0;
  let globalLockedUntil = 0;

  function touch(key: string, nowMs: number): Entry {
    const existing = keys.get(key);
    const entry: Entry = existing ?? {
      fails: 0,
      windowStart: nowMs,
      lockedUntil: 0,
      lockLevel: 0,
      lastSeen: nowMs,
    };
    entry.lastSeen = nowMs;
    keys.delete(key);
    keys.set(key, entry);
    return entry;
  }

  function prune(nowMs: number): void {
    for (const [key, entry] of keys) {
      // Insertion order is LRU order, so the first still-fresh entry ends the sweep.
      if (nowMs - entry.lastSeen <= IDLE_TTL_MS) break;
      keys.delete(key);
    }
    while (keys.size > MAX_KEYS) {
      const oldest = keys.keys().next().value;
      if (oldest === undefined) break;
      keys.delete(oldest);
    }
    if (trusted.size > MAX_TRUSTED_KEYS) {
      for (const [key, expiresAt] of trusted) {
        if (trusted.size <= MAX_TRUSTED_KEYS) break;
        if (expiresAt <= nowMs) trusted.delete(key);
      }
      while (trusted.size > MAX_TRUSTED_KEYS) {
        const oldest = trusted.keys().next().value;
        if (oldest === undefined) break;
        trusted.delete(oldest);
      }
    }
  }

  function isTrusted(key: string, nowMs: number): boolean {
    const expiresAt = trusted.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= nowMs) {
      trusted.delete(key);
      return false;
    }
    return true;
  }

  return {
    check(key, nowMs) {
      const entry = keys.get(key);
      if (entry && entry.lockedUntil > nowMs) {
        return {
          allowed: false,
          retryAfterSec: Math.ceil((entry.lockedUntil - nowMs) / 1000),
          reason: "key",
        };
      }
      if (globalLockedUntil > nowMs && !isTrusted(key, nowMs)) {
        return {
          allowed: false,
          retryAfterSec: Math.ceil((globalLockedUntil - nowMs) / 1000),
          reason: "global",
        };
      }
      return ALLOWED;
    },

    recordFailure(key, nowMs) {
      // Touch first, then prune: pruning to the cap before inserting would let
      // the map settle one entry above it.
      const entry = touch(key, nowMs);
      prune(nowMs);

      if (nowMs - entry.windowStart > WINDOW_MS) {
        entry.fails = 0;
        entry.windowStart = nowMs;
      }
      entry.fails += 1;
      if (entry.fails >= MAX_FAILS) {
        entry.lockLevel += 1;
        const lock = Math.min(BASE_LOCK_MS * 2 ** (entry.lockLevel - 1), MAX_LOCK_MS);
        entry.lockedUntil = nowMs + lock;
        entry.fails = 0;
        entry.windowStart = nowMs;
      }

      if (nowMs - globalWindowStart > GLOBAL_WINDOW_MS) {
        globalFails = 0;
        globalWindowStart = nowMs;
      }
      globalFails += 1;
      if (globalFails >= GLOBAL_MAX_FAILS) {
        globalLockedUntil = nowMs + GLOBAL_LOCK_MS;
        globalFails = 0;
        globalWindowStart = nowMs;
      }
    },

    recordSuccess(key, nowMs) {
      keys.delete(key);
      trusted.delete(key);
      trusted.set(key, nowMs + TRUSTED_TTL_MS);
      prune(nowMs);
    },

    stats(nowMs = Date.now()) {
      return {
        keys: keys.size,
        trusted: trusted.size,
        globalLocked: globalLockedUntil > nowMs,
      };
    },
  };
}
