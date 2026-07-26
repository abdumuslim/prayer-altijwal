import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/admin-audit");

/** Audit rows older than this are pruned by the daily retention job. */
export const AUDIT_RETENTION_DAYS = 365;

export interface AuditEntry {
  /** Dotted verb, e.g. "masjid.approve", "settings.update", "session.login". */
  action: string;
  /** What it acted on — an id or key, never a credential. */
  target?: string | null;
  /** IP PREFIX of the operator (/24 or /64), never a full address. */
  actorIp?: string | null;
  /** Small JSON blob of what changed. Must never contain secrets. */
  details?: Record<string, unknown> | null;
}

export interface AuditRow extends AuditEntry {
  id: number;
  at: string;
}

export interface AdminAuditRepo {
  /** Fire-and-forget: an audit failure must never fail the action it records. */
  append(entry: AuditEntry): Promise<void>;
  list(limit: number): Promise<AuditRow[]>;
  prune(olderThanDays: number): Promise<number>;
}

export function createAdminAuditRepo(pool: pg.Pool): AdminAuditRepo {
  return {
    async append(entry) {
      try {
        await pool.query(
          `INSERT INTO admin_audit (actor_ip, action, target, details)
                VALUES ($1, $2, $3, $4)`,
          [
            entry.actorIp ?? null,
            entry.action,
            entry.target ?? null,
            entry.details ? JSON.stringify(entry.details) : null,
          ],
        );
      } catch (err) {
        log.warn("audit append failed", err instanceof Error ? err : new Error(String(err)));
      }
    },

    async list(limit) {
      try {
        const { rows } = await pool.query(
          `SELECT id, at, actor_ip, action, target, details
             FROM admin_audit ORDER BY at DESC LIMIT $1`,
          [Math.min(Math.max(1, Math.floor(limit)), 500)],
        );
        return rows.map((r) => ({
          id: Number(r.id),
          at: new Date(r.at).toISOString(),
          actorIp: r.actor_ip ?? null,
          action: String(r.action),
          target: r.target ?? null,
          details: (r.details as Record<string, unknown> | null) ?? null,
        }));
      } catch (err) {
        log.warn("audit list failed", err instanceof Error ? err : new Error(String(err)));
        return [];
      }
    },

    async prune(olderThanDays) {
      try {
        const { rowCount } = await pool.query(
          `DELETE FROM admin_audit WHERE at < NOW() - ($1::int * INTERVAL '1 day')`,
          [Math.max(1, Math.floor(olderThanDays))],
        );
        return rowCount ?? 0;
      } catch (err) {
        log.warn("audit prune failed", err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    },
  };
}
