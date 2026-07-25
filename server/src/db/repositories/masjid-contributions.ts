import pg from "pg";
import { childLogger } from "../../logger.js";
import type { Masjid } from "../../places/google-places.js";

const log = childLogger("db/masjid-contributions");

/** Submissions allowed per client per day — generous for a real contributor. */
export const MAX_CONTRIBUTIONS_PER_DAY = 5;

export interface ContributionInput {
  name: string;
  lat: number;
  lon: number;
  clientId: string;
}

export interface MasjidContributionsRepo {
  /** Store a submission as pending. False ⇒ the daily limit refused it. */
  submit(input: ContributionInput): Promise<boolean>;
  /** Approved contributions, shaped for the resident index. */
  approved(): Promise<Masjid[]>;
}

export function createMasjidContributionsRepo(pool: pg.Pool): MasjidContributionsRepo {
  return {
    async submit(input) {
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS n FROM masjid_contributions
            WHERE client_id = $1 AND created_at > NOW() - INTERVAL '1 day'`,
          [input.clientId],
        );
        if ((rows[0]?.n ?? 0) >= MAX_CONTRIBUTIONS_PER_DAY) return false;

        await pool.query(
          `INSERT INTO masjid_contributions (name, lat, lon, client_id, status)
                VALUES ($1, $2, $3, $4, 'pending')`,
          [input.name, input.lat, input.lon, input.clientId],
        );
        log.info("masjid contribution received", { lat: input.lat, lon: input.lon });
        return true;
      } catch (err) {
        log.warn("contribution insert failed", err instanceof Error ? err : new Error(String(err)));
        return false;
      }
    },

    async approved() {
      try {
        const { rows } = await pool.query(
          `SELECT id, name, lat, lon FROM masjid_contributions WHERE status = 'approved'`,
        );
        return rows.map((r) => ({
          // Namespaced so a community masjid is never mistaken for a Google
          // place id in a Maps deep link.
          id: `usr:${r.id}`,
          name: String(r.name),
          lat: Number(r.lat),
          lon: Number(r.lon),
          address: null,
        }));
      } catch (err) {
        log.warn("approved read failed", err instanceof Error ? err : new Error(String(err)));
        return [];
      }
    },
  };
}
