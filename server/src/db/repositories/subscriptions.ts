import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/subscriptions");

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
export class PgSubscriptionsRepo implements SubscriptionsRepo {
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
    log.info("Subscription upserted", { endpoint: sub.endpoint });
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await this.pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
    log.info("Subscription deleted", { endpoint });
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
    log.info("Subscription prefs updated", { endpoint, fields: Object.keys(prefs) });
  }

  async listAll(): Promise<Subscription[]> {
    const { rows } = await this.pool.query<SubscriptionRow>(
      `SELECT endpoint, subscription, lat, lon, tz, country, method, asr,
              lead_minutes, prayers, lang
         FROM push_subscriptions`,
    );
    return rows.map(rowToSubscription);
  }
}
