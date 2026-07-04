import pg from "pg";
import { childLogger } from "../../logger.js";

const log = childLogger("db/alert-rules");

/** When a reminder fires: at the prayer time, or N minutes before / after it. */
export type AlertTiming = "at_time" | "before" | "after";

/**
 * One reminder rule for a device: fire `prayers` at `timing` (`minutes` before or
 * after when timing is "before"/"after"; null/ignored when "at_time"). A device
 * can own many independent rules — the multi-alert model ported from home.
 */
export interface AlertRule {
  id: number;
  endpoint: string;
  timing: AlertTiming;
  minutes: number | null;
  prayers: string[];
}

export type AlertRuleInput = Omit<AlertRule, "id">;

export interface AlertRulesRepo {
  listByEndpoint(endpoint: string): Promise<AlertRule[]>;
  /** All rules across all devices — the scheduler groups them per endpoint. */
  listAll(): Promise<AlertRule[]>;
  create(input: AlertRuleInput): Promise<AlertRule>;
  /** Update a rule, scoped to its owning endpoint; null if not found/owned. */
  update(
    id: number,
    endpoint: string,
    patch: Pick<AlertRuleInput, "timing" | "minutes" | "prayers">,
  ): Promise<AlertRule | null>;
  /** Delete a rule, scoped to its owning endpoint. */
  delete(id: number, endpoint: string): Promise<void>;
}

interface AlertRuleRow {
  id: number;
  endpoint: string;
  timing: AlertTiming;
  minutes: number | null;
  prayers: string[];
}

function rowToRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    endpoint: row.endpoint,
    timing: row.timing,
    minutes: row.minutes,
    prayers: row.prayers,
  };
}

const SELECT = "SELECT id, endpoint, timing, minutes, prayers FROM prayer_alert_rules";

/** Postgres-backed implementation. */
export class PgAlertRulesRepo implements AlertRulesRepo {
  constructor(private readonly pool: pg.Pool) {}

  async listByEndpoint(endpoint: string): Promise<AlertRule[]> {
    const { rows } = await this.pool.query<AlertRuleRow>(
      `${SELECT} WHERE endpoint = $1 ORDER BY id ASC`,
      [endpoint],
    );
    return rows.map(rowToRule);
  }

  async listAll(): Promise<AlertRule[]> {
    const { rows } = await this.pool.query<AlertRuleRow>(`${SELECT} ORDER BY id ASC`);
    return rows.map(rowToRule);
  }

  async create(input: AlertRuleInput): Promise<AlertRule> {
    const { rows } = await this.pool.query<AlertRuleRow>(
      `INSERT INTO prayer_alert_rules (endpoint, timing, minutes, prayers)
       VALUES ($1, $2, $3, $4)
       RETURNING id, endpoint, timing, minutes, prayers`,
      [input.endpoint, input.timing, input.minutes, input.prayers],
    );
    log.info("Alert rule created", { endpoint: input.endpoint, id: rows[0]?.id });
    return rowToRule(rows[0]);
  }

  async update(
    id: number,
    endpoint: string,
    patch: Pick<AlertRuleInput, "timing" | "minutes" | "prayers">,
  ): Promise<AlertRule | null> {
    const { rows } = await this.pool.query<AlertRuleRow>(
      `UPDATE prayer_alert_rules
         SET timing = $1, minutes = $2, prayers = $3, updated_at = NOW()
       WHERE id = $4 AND endpoint = $5
       RETURNING id, endpoint, timing, minutes, prayers`,
      [patch.timing, patch.minutes, patch.prayers, id, endpoint],
    );
    return rows[0] ? rowToRule(rows[0]) : null;
  }

  async delete(id: number, endpoint: string): Promise<void> {
    await this.pool.query("DELETE FROM prayer_alert_rules WHERE id = $1 AND endpoint = $2", [
      id,
      endpoint,
    ]);
    log.info("Alert rule deleted", { endpoint, id });
  }
}
