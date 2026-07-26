import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/app-settings");

/** How long a cached value is trusted before the next read refreshes it. */
const CACHE_TTL_MS = 30_000;

export interface AppSettingsRepo {
  /**
   * Read an override. ALWAYS returns `fallback` when the row is missing, the
   * value is the wrong shape, or the database is unavailable — a DB outage must
   * never silently disable a feature.
   */
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  /** Every stored override, for the settings page. */
  all(): Promise<Record<string, unknown>>;
}

/**
 * Runtime overrides for knobs that would otherwise need a redeploy — the Places
 * kill-switch and its monthly cap. Backed by a tiny table plus a 30-second
 * cache, because these are read on the request path.
 */
export function createAppSettings(pool: pg.Pool): AppSettingsRepo {
  let cache = new Map<string, unknown>();
  let loadedAt = 0;
  let inflight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    try {
      const { rows } = await pool.query(`SELECT key, value FROM app_settings`);
      const next = new Map<string, unknown>();
      for (const r of rows) next.set(String(r.key), r.value);
      cache = next;
      loadedAt = Date.now();
    } catch (err) {
      // Keep serving the last known values (or none) rather than failing.
      log.warn("settings refresh failed", err instanceof Error ? err : new Error(String(err)));
      loadedAt = Date.now(); // don't hammer a down database on every request
    }
  }

  async function ensureFresh(): Promise<void> {
    if (Date.now() - loadedAt < CACHE_TTL_MS) return;
    // Collapse concurrent refreshes into one query.
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    await inflight;
  }

  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      await ensureFresh();
      const value = cache.get(key);
      if (value === undefined || value === null) return fallback;
      // A stored value of the wrong type is a corrupt row, not an instruction.
      if (typeof value !== typeof fallback) {
        log.warn("settings type mismatch — using fallback", { key });
        return fallback;
      }
      return value as T;
    },

    async set(key, value) {
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
              VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)],
      );
      cache.set(key, value);
    },

    async all() {
      await ensureFresh();
      return Object.fromEntries(cache);
    },
  };
}
