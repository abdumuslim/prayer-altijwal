import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createAdminRouter } from "../index.js";
import { hashPassword, issueSession } from "../auth.js";
import { SESSION_COOKIE } from "../cookie.js";
import { ResidentIndex } from "../../places/resident-index.js";
import type {
  ContributionRow,
  ContributionStatus,
  MasjidContributionsRepo,
} from "../../db/repositories/masjid-contributions.js";

const PASSWORD = "moderator password";
const HASH = hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 });
const SECRET = "test-session-secret-at-least-32-chars-long";

/** Karrada, Baghdad — the fixture neighbourhood for duplicate detection. */
const BASE_MASJIDS = [
  { oid: "1", n: "جامع الرحمن", lat: 33.3, lon: 44.4 },
  { oid: "2", n: "مسجد النور", lat: 33.31, lon: 44.41 },
];

function row(over: Partial<ContributionRow> = {}): ContributionRow {
  return {
    id: 1,
    name: "جامع جديد",
    lat: 33.5,
    lon: 44.5,
    clientId: "abcdefghijklmnop",
    status: "pending",
    createdAt: "2026-07-26T10:00:00.000Z",
    ...over,
  };
}

function fakeRepo(rows: ContributionRow[]) {
  const store = new Map(rows.map((r) => [r.id, { ...r }]));
  const repo: MasjidContributionsRepo = {
    async submit() {
      return true;
    },
    async approved() {
      return [...store.values()]
        .filter((r) => r.status === "approved")
        .map((r) => ({ id: `usr:${r.id}`, name: r.name, lat: r.lat, lon: r.lon, address: null }));
    },
    async listByStatus(status, limit, offset) {
      return [...store.values()].filter((r) => r.status === status).slice(offset, offset + limit);
    },
    async counts() {
      const out: Record<ContributionStatus, number> = { pending: 0, approved: 0, rejected: 0 };
      for (const r of store.values()) out[r.status] += 1;
      return out;
    },
    async update(id, edit) {
      const existing = store.get(id);
      if (!existing) return null;
      const next = { ...existing, ...edit };
      store.set(id, next);
      return next;
    },
  };
  return { repo, store };
}

interface Harness {
  base: string;
  cookie: string;
  close: () => Promise<void>;
  refreshCalls: number[];
}

async function start(rows: ContributionRow[], withResident = true): Promise<Harness & { store: Map<number, ContributionRow> }> {
  const { repo, store } = fakeRepo(rows);
  const resident = ResidentIndex.fromRows(BASE_MASJIDS);
  const refreshCalls: number[] = [];

  const app = express();
  app.use(express.json());
  app.use(
    createAdminRouter({
      session: { passwordHash: HASH, sessionSecret: SECRET, secureCookies: false },
      contributions: repo,
      resident: withResident ? resident : undefined,
      refreshCommunity: async () => {
        const approved = await repo.approved();
        resident.setCommunity(approved);
        refreshCalls.push(approved.length);
        return approved.length;
      },
      serverVersion: "test",
      startedAt: Date.now(),
      env: "test",
      getDbStatus: async () => "up",
      monthlyCap: 4500,
      settingsDefaults: {
        placesEnabled: false,
        placesTravelEnabled: true,
        placesMonthlyUnitCap: 4500,
        telemetryEnabled: false,
      },
      flags: { placesEnabled: false, pushEnabled: false, telemetryEnabled: false },
    }),
  );

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const { token } = issueSession(HASH, SECRET, Date.now());

  return {
    base: `http://127.0.0.1:${port}`,
    cookie: `${SESSION_COOKIE}=${token}`,
    refreshCalls,
    store,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let h: Awaited<ReturnType<typeof start>>;
afterEach(() => h?.close());

describe("GET /api/admin/masjids/contributions", () => {
  beforeEach(async () => {
    h = await start([
      row({ id: 1, status: "pending" }),
      row({ id: 2, status: "pending", name: "جامع ثاني" }),
      row({ id: 3, status: "approved" }),
    ]);
  });

  it("requires a session", async () => {
    const res = await fetch(`${h.base}/api/admin/masjids/contributions`);
    expect(res.status).toBe(401);
  });

  it("lists the pending queue with counts", async () => {
    const res = await fetch(`${h.base}/api/admin/masjids/contributions`, {
      headers: { cookie: h.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; counts: Record<string, number>; items: unknown[] };
    expect(body.total).toBe(2);
    expect(body.counts).toEqual({ pending: 2, approved: 1, rejected: 0 });
    expect(body.items).toHaveLength(2);
  });

  it("NEVER returns a full client id", async () => {
    const res = await fetch(`${h.base}/api/admin/masjids/contributions`, {
      headers: { cookie: h.cookie },
    });
    const text = await res.text();
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).toContain("abcdefgh…");
  });

  it("rejects an unknown status instead of guessing", async () => {
    const res = await fetch(`${h.base}/api/admin/masjids/contributions?status=bogus`, {
      headers: { cookie: h.cookie },
    });
    expect(res.status).toBe(400);
  });
});

describe("duplicate detection", () => {
  it("flags a submission on top of a known masjid and reports the distance", async () => {
    // ~40 m from the fixture's جامع الرحمن.
    h = await start([row({ id: 1, name: "جامع الرحمن", lat: 33.3003, lon: 44.4003 })]);
    const res = await fetch(`${h.base}/api/admin/masjids/contributions`, {
      headers: { cookie: h.cookie },
    });
    const body = (await res.json()) as {
      items: { duplicate: boolean; nearest: { name: string; distanceM: number } }[];
    };
    expect(body.items[0].duplicate).toBe(true);
    expect(body.items[0].nearest.name).toBe("جامع الرحمن");
    expect(body.items[0].nearest.distanceM).toBeLessThan(100);
  });

  it("does not flag a genuinely new location", async () => {
    h = await start([row({ id: 1, lat: 33.9, lon: 44.9 })]);
    const res = await fetch(`${h.base}/api/admin/masjids/contributions`, {
      headers: { cookie: h.cookie },
    });
    const body = (await res.json()) as { items: { duplicate: boolean; nearest: unknown }[] };
    expect(body.items[0].duplicate).toBe(false);
    expect(body.items[0].nearest).toBeNull();
  });
});

describe("PATCH /api/admin/masjids/contributions/:id", () => {
  beforeEach(async () => {
    h = await start([row({ id: 1, status: "pending" })]);
  });

  const patch = (body: unknown, extraHeaders: Record<string, string> = {}) =>
    fetch(`${h.base}/api/admin/masjids/contributions/1`, {
      method: "PATCH",
      headers: {
        cookie: h.cookie,
        "Content-Type": "application/json",
        "X-Admin-Request": "1",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });

  it("requires the CSRF header", async () => {
    const res = await fetch(`${h.base}/api/admin/masjids/contributions/1`, {
      method: "PATCH",
      headers: { cookie: h.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(res.status).toBe(403);
  });

  it("approves and pushes the masjid live immediately", async () => {
    const res = await patch({ status: "approved" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: { status: string }; liveCount: number };
    expect(body.item.status).toBe("approved");
    // The whole point: the moderator does not wait for the 10-minute poll.
    expect(h.refreshCalls).toEqual([1]);
    expect(body.liveCount).toBe(1);
  });

  it("supports rejecting and then undoing", async () => {
    await patch({ status: "rejected" });
    expect(h.store.get(1)?.status).toBe("rejected");
    await patch({ status: "pending" });
    expect(h.store.get(1)?.status).toBe("pending");
  });

  it("corrects a name or coordinates without touching the status", async () => {
    const res = await patch({ name: "الاسم الصحيح", lat: 33.55 });
    expect(res.status).toBe(200);
    const stored = h.store.get(1)!;
    expect(stored.name).toBe("الاسم الصحيح");
    expect(stored.lat).toBe(33.55);
    expect(stored.status).toBe("pending");
    // No status change ⇒ no need to disturb the live index.
    expect(h.refreshCalls).toEqual([]);
  });

  it("validates the payload", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ status: "bogus" })).status).toBe(400);
    expect((await patch({ lat: 999 })).status).toBe(400);
    expect((await patch({ name: "x" })).status).toBe(400);
  });

  it("404s an unknown row", async () => {
    const res = await fetch(`${h.base}/api/admin/masjids/contributions/999`, {
      method: "PATCH",
      headers: { cookie: h.cookie, "Content-Type": "application/json", "X-Admin-Request": "1" },
      body: JSON.stringify({ status: "approved" }),
    });
    expect(res.status).toBe(404);
  });
});
