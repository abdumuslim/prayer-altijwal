import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/telemetry");

/** One anonymous daily ping, already coarsened and hashed. */
export interface UsagePing {
  day: string;
  dauHash: string;
  platform: string;
  appVersion: string | null;
  lat: number | null;
  lon: number | null;
  locPrecision: number;
  locSource: string | null;
  country: string | null;
  city: string | null;
  tz: string | null;
  features: string[];
  notif: boolean;
  theme: string | null;
  displayMode: string | null;
}

export interface TelemetryRepo {
  record(ping: UsagePing): Promise<void>;
  prune(olderThanDays: number): Promise<number>;
}

export function createTelemetryRepo(pool: pg.Pool): TelemetryRepo {
  return {
    async record(p) {
      try {
        // PK (day, dau_hash) makes this idempotent: a second ping the same day
        // refreshes the row instead of adding one, so a row count IS the
        // daily-unique install count. first_seen is deliberately not updated.
        await pool.query(
          `INSERT INTO usage_ping
             (day, dau_hash, platform, app_version, lat, lon, loc_precision, loc_source,
              country, city, tz, features, notif, theme, display_mode)
           VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14, $15)
           ON CONFLICT (day, dau_hash) DO UPDATE SET
             last_seen    = NOW(),
             platform     = EXCLUDED.platform,
             app_version  = EXCLUDED.app_version,
             lat          = EXCLUDED.lat,
             lon          = EXCLUDED.lon,
             loc_precision= EXCLUDED.loc_precision,
             loc_source   = EXCLUDED.loc_source,
             country      = EXCLUDED.country,
             city         = EXCLUDED.city,
             tz           = EXCLUDED.tz,
             features     = EXCLUDED.features,
             notif        = EXCLUDED.notif,
             theme        = EXCLUDED.theme,
             display_mode = EXCLUDED.display_mode`,
          [
            p.day,
            p.dauHash,
            p.platform,
            p.appVersion,
            p.lat,
            p.lon,
            p.locPrecision,
            p.locSource,
            p.country,
            p.city,
            p.tz,
            p.features,
            p.notif,
            p.theme,
            p.displayMode,
          ],
        );
      } catch (err) {
        // Telemetry must never be able to affect the app: swallow and move on.
        log.warn("usage ping write failed", err instanceof Error ? err : new Error(String(err)));
      }
    },

    async prune(olderThanDays) {
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM usage_ping WHERE day < CURRENT_DATE - ($1::int)`,
          [Math.max(1, Math.floor(olderThanDays))],
        );
        return rowCount ?? 0;
      } catch (err) {
        log.warn("usage ping prune failed", err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    },
  };
}
