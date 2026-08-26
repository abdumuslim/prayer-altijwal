import { createHash } from "node:crypto";
import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/subscriptions");

/**
 * A subscription with no reminder rules is inert — the scheduler skips it every
 * tick — yet nothing ever removes it, so these rows accumulate forever as
 * devices subscribe and drift away without ever configuring an alert. Delete a
 * ruleless row once it has been untouched (no upsert / prefs change) for this
 * long. Mirrors the other retention constants (e.g. AUDIT_RETENTION_DAYS).
 */
export const DEAD_SUBSCRIPTION_RETENTION_DAYS = 45;

/**
 * A push endpoint URL is a bearer-capable credential (anyone holding it can push
 * to that device), so it must never be logged verbatim to stdout — the container
 * log driver would retain it. Reduce it to its host plus a short, non-reversible
 * token (the first 8 hex of a sha256) — enough to correlate log lines for one
 * subscriber without exposing the URL. Shared so every log site redacts alike.
 */
export function redactEndpoint(endpoint: string): string {
  let host = "invalid";
  try {
    host = new URL(endpoint).host;
  } catch {
    // Malformed URL: keep the "invalid" host, still emit a token to correlate.
  }
  const token = createHash("sha256").update(endpoint).digest("hex").slice(0, 8);
  return `${host}#${token}`;
}

/**
 * A push subscriber: their Web Push token plus the location + preferences the
 * scheduler needs to compute and fire reminders. `tz` is the SUBSCRIBER's IANA
 * tz (hard rule 4), never the device tz of whoever is running the server.
 */
export interface Subscription {
  endpoint: string;
  /** The browser PushSubscription JSON (endpoint + keys). Stored as JSONB. */
  subscription: unknown;
  lat: number;
  lon: number;
  tz: string;
  country: string | null;
  method: string;
  asr: string;
  leadMinutes: number[];
  prayers: string[];
  lang: string;
}

/** Fields a client may change after subscribing (all optional). */
export type SubscriptionPrefs = Partial<
  Pick<Subscription, "prayers" | "leadMinutes" | "method" | "asr" | "lang">
>;

/**
 * The narrow slice of the subscriptions store the retention job needs. Kept
 * separate from SubscriptionsRepo so the many in-memory fakes that implement the
 * full CRUD interface aren't forced to carry a prune method they never exercise.
 */
export interface OrphanSubscriptionPruner {
  /**
   * Delete ruleless subscriptions untouched for longer than `olderThanDays`.
   * Returns how many rows were removed.
   */
  pruneOrphaned(olderThanDays: number): Promise<number>;
}

/** Storage abstraction so the scheduler + routes can be tested with a fake. */
export interface SubscriptionsRepo {
  upsert(sub: Subscription): Promise<void>;
  deleteByEndpoint(endpoint: string): Promise<void>;
  /**
   * Delete by numeric id — the admin dashboard's handle on a subscriber, since
   * it is never given the full endpoint (that URL is a bearer credential).
   * Returns false when no such row existed.
   */
  deleteById(id: number): Promise<boolean>;
  updatePrefs(endpoint: string, prefs: SubscriptionPrefs): Promise<void>;
  listAll(): Promise<Subscription[]>;
}

interface SubscriptionRow {
  endpoint: string;
  subscription: unknown;
  lat: number;
  lon: number;
  tz: string;
  country: string | null;
  method: string;
  asr: string;
  lead_minutes: number[];
  prayers: string[];
  lang: string;
}

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    endpoint: row.endpoint,
    subscription: row.subscription,
    lat: row.lat,
    lon: row.lon,
    tz: row.tz,
    country: row.country,
    method: row.method,
    asr: row.asr,
    leadMinutes: row.lead_minutes,
    prayers: row.prayers,
    lang: row.lang,
  };
}

/** Postgres-backed implementation. */
export class PgSubscriptionsRepo implements SubscriptionsRepo, OrphanSubscriptionPruner {
  constructor(private readonly pool: pg.Pool) {}

  async upsert(sub: Subscription): Promise<void> {
    await this.pool.query(
      `INSERT INTO push_subscriptions
         (endpoint, subscription, lat, lon, tz, country, method, asr, lead_minutes, prayers, lang, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (endpoint) DO UPDATE SET
         subscription = EXCLUDED.subscription,
         lat          = EXCLUDED.lat,
         lon          = EXCLUDED.lon,
         tz           = EXCLUDED.tz,
         country      = EXCLUDED.country,
         method       = EXCLUDED.method,
         asr          = EXCLUDED.asr,
         lead_minutes = EXCLUDED.lead_minutes,
         prayers      = EXCLUDED.prayers,
         lang         = EXCLUDED.lang,
         updated_at   = NOW()`,
      [
        sub.endpoint,
        JSON.stringify(sub.subscription),
        sub.lat,
        sub.lon,
        sub.tz,
        sub.country,
        sub.method,
        sub.asr,
        sub.leadMinutes,
        sub.prayers,
        sub.lang,
      ],
    );
    log.info("Subscription upserted", { endpoint: redactEndpoint(sub.endpoint) });
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await this.pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    log.info("Subscription deleted", { endpoint: redactEndpoint(endpoint) });
  }

  async deleteById(id: number): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM push_subscriptions WHERE id = $1", [id]);
    if (rowCount) log.info("Subscription deleted by id", { id });
    return (rowCount ?? 0) > 0;
  }

  async updatePrefs(endpoint: string, prefs: SubscriptionPrefs): Promise<void> {
    // Build a parameterized partial UPDATE — only the supplied columns change.
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const add = (column: string, value: unknown) => {
      sets.push(`${column} = $${i++}`);
      values.push(value);
    };

    if (prefs.prayers !== undefined) add("prayers", prefs.prayers);
    if (prefs.leadMinutes !== undefined) add("lead_minutes", prefs.leadMinutes);
    if (prefs.method !== undefined) add("method", prefs.method);
    if (prefs.asr !== undefined) add("asr", prefs.asr);
    if (prefs.lang !== undefined) add("lang", prefs.lang);

    if (sets.length === 0) return; // nothing to update

    sets.push("updated_at = NOW()");
    values.push(endpoint);
    await this.pool.query(
      `UPDATE push_subscriptions SET ${sets.join(", ")} WHERE endpoint = $${i}`,
      values,
    );
    log.info("Subscription prefs updated", {
      endpoint: redactEndpoint(endpoint),
      fields: Object.keys(prefs),
    });
  }

  async listAll(): Promise<Subscription[]> {
    const { rows } = await this.pool.query<SubscriptionRow>(
      `SELECT endpoint, subscription, lat, lon, tz, country, method, asr,
              lead_minutes, prayers, lang
         FROM push_subscriptions`,
    );
    return rows.map(rowToSubscription);
  }

  async pruneOrphaned(olderThanDays: number): Promise<number> {
    // One statement: delete only stale rows that own no alert rule. The FK on
    // prayer_alert_rules cascades on subscription delete, so a row matched here
    // genuinely has zero reminders — the NOT EXISTS is the whole gate. Self-
    // guards like the other retention pruners so one failure can't stall the
    // daily sweep.
    try {
      const { rowCount } = await this.pool.query(
        `DELETE FROM push_subscriptions s
          WHERE s.updated_at < NOW() - ($1::int * INTERVAL '1 day')
            AND NOT EXISTS (
              SELECT 1 FROM prayer_alert_rules r WHERE r.endpoint = s.endpoint
            )`,
        [Math.max(1, Math.floor(olderThanDays))],
      );
      return rowCount ?? 0;
    } catch (err) {
      log.warn("orphan subscription prune failed", err instanceof Error ? err : new Error(String(err)));
      return 0;
    }
  }
}
