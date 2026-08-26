import { describe, it, expect } from "vitest";
import pg from "pg";
import {
  PgAlertRulesRepo,
  MAX_ALERT_RULES_PER_ENDPOINT,
  type AlertRuleInput,
} from "./alert-rules.js";

/**
 * The per-endpoint reminder cap used to be a list-then-insert check in the
 * route, which two concurrent creates could both read stale and race past.
 * create() now enforces it atomically inside a transaction: a per-endpoint
 * advisory lock, then a count-guarded insert. These tests pin that ordering
 * against a recording fake client: BEGIN, advisory lock, COUNT, (insert or
 * skip), COMMIT on a dedicated connection that is always released.
 */

interface Recorded {
  text: string;
  values?: unknown[];
}

class FakeClient {
  readonly queries: Recorded[] = [];
  released = false;
  constructor(private readonly opts: { count?: number; throwOn?: RegExp } = {}) {}

  async query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    this.queries.push({ text, values });
    if (this.opts.throwOn && this.opts.throwOn.test(text)) throw new Error("boom");
    if (/COUNT\(\*\)/.test(text)) {
      return { rows: [{ n: this.opts.count ?? 0 }], rowCount: 1 };
    }
    if (/INSERT INTO prayer_alert_rules/.test(text)) {
      const v = values ?? [];
      return {
        rows: [
          { id: 7, endpoint: v[0], timing: v[1], minutes: v[2], prayers: v[3], kind: v[4] },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

class FakePool {
  readonly client: FakeClient;
  constructor(opts: { count?: number; throwOn?: RegExp } = {}) {
    this.client = new FakeClient(opts);
  }
  async connect(): Promise<FakeClient> {
    return this.client;
  }
  async query(): Promise<never> {
    throw new Error("create() must use a pooled client, not pool.query");
  }
}

function texts(pool: FakePool): string[] {
  return pool.client.queries.map((q) => q.text.replace(/\s+/g, " ").trim());
}

const EP = "https://fcm.googleapis.com/fcm/send/ep1";
const INPUT: AlertRuleInput = {
  endpoint: EP,
  timing: "at_time",
  minutes: null,
  prayers: ["fajr"],
  kind: "notification",
};

describe("PgAlertRulesRepo.create: serialized per-endpoint cap", () => {
  it("runs BEGIN → advisory lock → COUNT → INSERT → COMMIT under the cap, then releases", async () => {
    const pool = new FakePool({ count: 0 });
    const repo = new PgAlertRulesRepo(pool as unknown as pg.Pool);

    const result = await repo.create(INPUT);
    expect(result).toEqual({
      ok: true,
      rule: {
        id: 7,
        endpoint: EP,
        timing: "at_time",
        minutes: null,
        prayers: ["fajr"],
        kind: "notification",
      },
    });

    const t = texts(pool);
    expect(t[0]).toBe("BEGIN");
    expect(t[1]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    expect(t[2]).toMatch(/COUNT\(\*\)/);
    expect(t[3]).toMatch(/^INSERT INTO prayer_alert_rules/);
    expect(t[4]).toBe("COMMIT");

    // The lock is keyed by the endpoint, taken before the count is read.
    expect(pool.client.queries[1].values).toEqual([EP]);
    expect(pool.client.released).toBe(true);
  });

  it("takes the lock strictly before counting, and counts before inserting", async () => {
    const pool = new FakePool({ count: 0 });
    const repo = new PgAlertRulesRepo(pool as unknown as pg.Pool);
    await repo.create(INPUT);

    const t = texts(pool);
    const lockAt = t.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    const countAt = t.findIndex((s) => /COUNT\(\*\)/.test(s));
    const insertAt = t.findIndex((s) => /^INSERT INTO prayer_alert_rules/.test(s));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(countAt).toBeGreaterThan(lockAt);
    expect(insertAt).toBeGreaterThan(countAt);
  });

  it("signals a refusal (no insert) once the endpoint is at the cap", async () => {
    const pool = new FakePool({ count: MAX_ALERT_RULES_PER_ENDPOINT });
    const repo = new PgAlertRulesRepo(pool as unknown as pg.Pool);

    const result = await repo.create(INPUT);
    expect(result).toEqual({ ok: false, reason: "limit" });

    const t = texts(pool);
    expect(t.some((s) => /^INSERT INTO prayer_alert_rules/.test(s))).toBe(false);
    // A read-only transaction still COMMITs and releases (it is not an error).
    expect(t).toContain("COMMIT");
    expect(pool.client.released).toBe(true);
  });

  it("rolls back, rethrows, and still releases when a statement fails", async () => {
    const pool = new FakePool({ count: 0, throwOn: /INSERT INTO prayer_alert_rules/ });
    const repo = new PgAlertRulesRepo(pool as unknown as pg.Pool);

    await expect(repo.create(INPUT)).rejects.toThrow();
    const t = texts(pool);
    expect(t).toContain("ROLLBACK");
    expect(t).not.toContain("COMMIT");
    expect(pool.client.released).toBe(true);
  });
});
