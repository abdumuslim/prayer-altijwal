import { describe, it, expect } from "vitest";
import pg from "pg";
import {
  createMasjidContributionsRepo,
  MAX_CONTRIBUTIONS_PER_DAY,
} from "./masjid-contributions.js";

/**
 * The 5/day per-client cap is a `WHERE`-guarded count-and-insert, which alone is
 * NOT serialized under READ COMMITTED: two concurrent submissions can both read
 * the same pre-insert count and both slip past. submit() therefore runs in a
 * transaction that takes a per-client advisory lock before counting. These tests
 * pin that mechanism against a recording fake client: BEGIN → advisory lock →
 * guarded insert → COMMIT on a dedicated pooled connection that is always
 * released.
 */

interface Recorded {
  text: string;
  values?: unknown[];
}

class FakeClient {
  readonly queries: Recorded[] = [];
  released = false;
  constructor(private readonly opts: { insertRowCount?: number; throwOn?: RegExp } = {}) {}

  async query(text: string, values?: unknown[]): Promise<{ rowCount: number; rows: unknown[] }> {
    this.queries.push({ text, values });
    if (this.opts.throwOn && this.opts.throwOn.test(text)) throw new Error("boom");
    if (/INSERT INTO masjid_contributions/.test(text)) {
      return { rowCount: this.opts.insertRowCount ?? 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

class FakePool {
  readonly client: FakeClient;
  constructor(opts: { insertRowCount?: number; throwOn?: RegExp } = {}) {
    this.client = new FakeClient(opts);
  }
  async connect(): Promise<FakeClient> {
    return this.client;
  }
  async query(): Promise<never> {
    throw new Error("submit() must use a pooled client, not pool.query");
  }
}

/** Normalized statement texts, so the SQL's own whitespace doesn't matter. */
function texts(pool: FakePool): string[] {
  return pool.client.queries.map((q) => q.text.replace(/\s+/g, " ").trim());
}

const INPUT = { name: "Masjid al-Test", lat: 33.31, lon: 44.36, clientId: "client-abc" };

describe("createMasjidContributionsRepo.submit: serialized cap", () => {
  it("runs BEGIN → per-client advisory lock → guarded insert → COMMIT, then releases", async () => {
    const pool = new FakePool({ insertRowCount: 1 });
    const repo = createMasjidContributionsRepo(pool as unknown as pg.Pool);

    const ok = await repo.submit(INPUT);
    expect(ok).toBe(true);

    const t = texts(pool);
    expect(t[0]).toBe("BEGIN");
    expect(t[1]).toMatch(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
    expect(t[2]).toMatch(/^INSERT INTO masjid_contributions/);
    expect(t[3]).toBe("COMMIT");

    // The lock is keyed by the client id, before any count is read.
    expect(pool.client.queries[1].values).toEqual([INPUT.clientId]);
    // The guarded insert carries the daily cap as its last parameter.
    expect(pool.client.queries[2].values).toEqual([
      INPUT.name,
      INPUT.lat,
      INPUT.lon,
      INPUT.clientId,
      MAX_CONTRIBUTIONS_PER_DAY,
    ]);
    // The dedicated connection is always returned to the pool.
    expect(pool.client.released).toBe(true);
  });

  it("takes the lock strictly before the counting insert", async () => {
    const pool = new FakePool({ insertRowCount: 1 });
    const repo = createMasjidContributionsRepo(pool as unknown as pg.Pool);
    await repo.submit(INPUT);

    const t = texts(pool);
    const lockAt = t.findIndex((s) => /pg_advisory_xact_lock/.test(s));
    const insertAt = t.findIndex((s) => /^INSERT INTO masjid_contributions/.test(s));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(lockAt);
  });

  it("commits and returns false when the cap refused the insert (0 rows)", async () => {
    const pool = new FakePool({ insertRowCount: 0 });
    const repo = createMasjidContributionsRepo(pool as unknown as pg.Pool);

    const ok = await repo.submit(INPUT);
    expect(ok).toBe(false);
    // A 0-row guarded insert is a committed no-op, not an error, so it COMMITs.
    expect(texts(pool)).toContain("COMMIT");
    expect(pool.client.released).toBe(true);
  });

  it("rolls back and returns false, still releasing, when a statement throws", async () => {
    const pool = new FakePool({ throwOn: /INSERT INTO masjid_contributions/ });
    const repo = createMasjidContributionsRepo(pool as unknown as pg.Pool);

    const ok = await repo.submit(INPUT);
    expect(ok).toBe(false);
    expect(texts(pool)).toContain("ROLLBACK");
    expect(texts(pool)).not.toContain("COMMIT");
    expect(pool.client.released).toBe(true);
  });
});
