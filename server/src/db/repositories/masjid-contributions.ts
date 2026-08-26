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

export type ContributionStatus = "pending" | "approved" | "rejected";

export const CONTRIBUTION_STATUSES: readonly ContributionStatus[] = [
  "pending",
  "approved",
  "rejected",
];

/** A moderation-queue row. `clientId` is truncated before it leaves the server. */
export interface ContributionRow {
  id: number;
  name: string;
  lat: number;
  lon: number;
  clientId: string | null;
  status: ContributionStatus;
  createdAt: string;
}

export interface ContributionEdit {
  name?: string;
  lat?: number;
  lon?: number;
  status?: ContributionStatus;
}

export interface MasjidContributionsRepo {
  /** Store a submission as pending. False ⇒ the daily limit refused it. */
  submit(input: ContributionInput): Promise<boolean>;
  /** Approved contributions, shaped for the resident index. */
  approved(): Promise<Masjid[]>;
  /** Moderation queue, newest first. */
  listByStatus(status: ContributionStatus, limit: number, offset: number): Promise<ContributionRow[]>;
  /** Row counts per status, for the queue badge. */
  counts(): Promise<Record<ContributionStatus, number>>;
  /** Apply a moderator's decision and/or correction. Null ⇒ no such row. */
  update(id: number, edit: ContributionEdit): Promise<ContributionRow | null>;
}

export function createMasjidContributionsRepo(pool: pg.Pool): MasjidContributionsRepo {
  return {
    async submit(input) {
      // Serialize a client's own submissions before counting. The WHERE-guarded
      // INSERT ... SELECT alone is NOT enough under READ COMMITTED: two
      // concurrent statements each take their own snapshot, both see the same
      // pre-insert count, and both slip past the cap. Wrapping the count-and-
      // insert in a transaction that first takes a per-client transaction-scoped
      // advisory lock makes concurrent submissions from one client queue instead
      // (the lock auto-releases at COMMIT/ROLLBACK), so the second one counts the
      // first's committed row. A dedicated pooled client is required: advisory
      // locks and BEGIN/COMMIT are connection-scoped, not poolable per-query.
      // submit() never throws (the route maps false to its "limit reached"
      // response), so failing to even acquire a connection is a false too.
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (err) {
        log.warn("contribution insert failed", err instanceof Error ? err : new Error(String(err)));
        return false;
      }
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.clientId]);
        const { rowCount } = await client.query(
          `INSERT INTO masjid_contributions (name, lat, lon, client_id, status)
                SELECT $1, $2, $3, $4, 'pending'
                 WHERE (
                   SELECT COUNT(*) FROM masjid_contributions
                    WHERE client_id = $4 AND created_at > NOW() - INTERVAL '1 day'
                 ) < $5`,
          [input.name, input.lat, input.lon, input.clientId, MAX_CONTRIBUTIONS_PER_DAY],
        );
        await client.query("COMMIT");
        if (!rowCount) return false; // rowCount 0 ⇒ the daily cap already refused it
        // Deliberately NOT logging lat/lon: pino writes to stdout, which the
        // container log driver retains, and user-submitted coordinates sitting
        // in logs undercuts the Play Data Safety answer that location is
        // processed ephemerally. The row itself is the record.
        log.info("masjid contribution received");
        return true;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        log.warn("contribution insert failed", err instanceof Error ? err : new Error(String(err)));
        return false;
      } finally {
        client.release();
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

    async listByStatus(status, limit, offset) {
      try {
        const { rows } = await pool.query(
          `SELECT id, name, lat, lon, client_id, status, created_at
             FROM masjid_contributions
            WHERE status = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3`,
          [status, clampLimit(limit), Math.max(0, Math.floor(offset))],
        );
        return rows.map(toRow);
      } catch (err) {
        log.warn("contribution list failed", err instanceof Error ? err : new Error(String(err)));
        return [];
      }
    },

    async counts() {
      const zero: Record<ContributionStatus, number> = { pending: 0, approved: 0, rejected: 0 };
      try {
        const { rows } = await pool.query(
          `SELECT status, COUNT(*)::int AS n FROM masjid_contributions GROUP BY status`,
        );
        const out = { ...zero };
        for (const r of rows) {
          const status = String(r.status) as ContributionStatus;
          if (status in out) out[status] = Number(r.n ?? 0);
        }
        return out;
      } catch (err) {
        log.warn("contribution counts failed", err instanceof Error ? err : new Error(String(err)));
        return zero;
      }
    },

    async update(id, edit) {
      // Built dynamically so a moderator can fix only the name, or only the
      // coordinates, without the untouched columns being rewritten.
      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (column: string, value: unknown): void => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (edit.name !== undefined) push("name", edit.name);
      if (edit.lat !== undefined) push("lat", edit.lat);
      if (edit.lon !== undefined) push("lon", edit.lon);
      if (edit.status !== undefined) push("status", edit.status);
      if (sets.length === 0) return null;

      values.push(id);
      try {
        const { rows } = await pool.query(
          `UPDATE masjid_contributions SET ${sets.join(", ")}
            WHERE id = $${values.length}
        RETURNING id, name, lat, lon, client_id, status, created_at`,
          values,
        );
        return rows[0] ? toRow(rows[0]) : null;
      } catch (err) {
        log.warn("contribution update failed", err instanceof Error ? err : new Error(String(err)));
        return null;
      }
    },
  };
}

const MAX_PAGE = 200;

function clampLimit(limit: number): number {
  return Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE);
}

function toRow(r: Record<string, unknown>): ContributionRow {
  return {
    id: Number(r.id),
    name: String(r.name),
    lat: Number(r.lat),
    lon: Number(r.lon),
    clientId: r.client_id === null || r.client_id === undefined ? null : String(r.client_id),
    status: String(r.status) as ContributionStatus,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}
