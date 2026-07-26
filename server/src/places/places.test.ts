import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cellCentre, cellIsUsable, gridKey, MAX_RESULTS, TtlLruCache } from "./cache.js";
import { createPlacesRouter } from "./routes.js";
import { searchNearbyMasjids, type Masjid } from "./google-places.js";
import { fetchTravelMinutes } from "./google-routes.js";
import { estimateTravel } from "./travel-estimate.js";
import { ResidentIndex } from "./resident-index.js";
import { haversineKm } from "../util/geo-distance.js";
import type { CachedCell, PlacesCacheRepo } from "../db/repositories/places-cache.js";
import type { PlacesOutcome, PlacesStatsRecorder } from "../db/repositories/places-stats.js";
import type { DenyReason, PlacesGovernor } from "./governor.js";
import type { MasjidContributionsRepo } from "../db/repositories/masjid-contributions.js";

// The router is tested against a mocked upstream so the in-process server can
// be hit with the real (local) fetch, matching the geo.test.ts pattern.
vi.mock("./google-places.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./google-places.js")>();
  return { ...actual, searchNearbyMasjids: vi.fn() };
});
vi.mock("./google-routes.js", () => ({ fetchTravelMinutes: vi.fn() }));
const mockSearch = vi.mocked(searchNearbyMasjids);
const mockTravel = vi.mocked(fetchTravelMinutes);

const BAGHDAD = { lat: 33.3152, lon: 44.3661 };
const MASJID: Masjid = {
  id: "place-1",
  name: "جامع الإمام الأعظم",
  lat: 33.372,
  lon: 44.355,
  address: "الأعظمية، بغداد",
};

/**
 * What the route now serves: the masjid plus a FREE estimate derived from the
 * caller's real distance. Computed here rather than hard-coded so this asserts
 * the wiring (the server estimates from the USER's position, not from the cell
 * centre it searched at) — the formula itself is pinned in travel-estimate.test.
 */
function servedFor(user: { lat: number; lon: number }, m: Masjid) {
  const km = haversineKm(user.lat, user.lon, m.lat, m.lon);
  return { ...m, ...estimateTravel(km), estimated: true };
}
const SERVED = servedFor(BAGHDAD, MASJID);

describe("cell geometry", () => {
  it("groups points within the ~1.1 km cell", () => {
    expect(gridKey(33.3152, 44.3661)).toBe(gridKey(33.3153, 44.3662));
  });

  it("separates points several km apart", () => {
    expect(gridKey(33.3152, 44.3661)).not.toBe(gridKey(33.35, 44.4));
  });

  it("round-trips a key to its cell centre", () => {
    const centre = cellCentre(gridKey(BAGHDAD.lat, BAGHDAD.lon));
    expect(centre).not.toBeNull();
    expect(centre!.lat).toBeCloseTo(33.32, 6);
    expect(centre!.lon).toBeCloseTo(44.37, 6);
    // The centre is always within a half-diagonal of any point in the cell.
    expect(haversineKm(BAGHDAD.lat, BAGHDAD.lon, centre!.lat, centre!.lon)).toBeLessThan(0.8);
  });

  it("rejects a malformed key rather than inventing a location", () => {
    expect(cellCentre("nonsense")).toBeNull();
    expect(cellCentre("1,2,3")).toBeNull();
    expect(cellCentre("a,b")).toBeNull();
  });
});

describe("cellIsUsable", () => {
  it("accepts an unsaturated search — it enumerated the whole radius", () => {
    expect(cellIsUsable({ resultCount: 3, maxDistKm: 0.4 }, 0.7)).toBe(true);
  });

  it("accepts an empty area (nothing found within 5 km is still an exhaustive answer)", () => {
    expect(cellIsUsable({ resultCount: 0, maxDistKm: 0 }, 0.7)).toBe(true);
  });

  it("accepts a saturated search whose coverage still reaches past the user", () => {
    // 20 results out to 4 km, user 0.7 km off-centre → 3.3 km of guaranteed
    // coverage around them, comfortably over the 1.5 km margin.
    expect(cellIsUsable({ resultCount: MAX_RESULTS, maxDistKm: 4 }, 0.7)).toBe(true);
  });

  it("REFUSES a saturated search that could be hiding a nearer masjid", () => {
    // Dense city centre: 20 results packed within 1 km of the centre. For a user
    // 0.7 km away only 0.3 km around them is guaranteed — not enough.
    expect(cellIsUsable({ resultCount: MAX_RESULTS, maxDistKm: 1 }, 0.7)).toBe(false);
  });

  it("refuses a nonsense distance rather than guessing", () => {
    expect(cellIsUsable({ resultCount: 1, maxDistKm: 5 }, Number.NaN)).toBe(false);
    expect(cellIsUsable({ resultCount: 1, maxDistKm: 5 }, -1)).toBe(false);
  });
});

describe("TtlLruCache", () => {
  it("serves within TTL and expires after it", () => {
    const cache = new TtlLruCache<string>(1000, 10);
    cache.set("k", "v", 0);
    expect(cache.get("k", 999)).toBe("v");
    expect(cache.get("k", 1000)).toBeUndefined();
  });

  it("evicts the least-recently-used entry past the cap", () => {
    const cache = new TtlLruCache<number>(60_000, 2);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    cache.get("a", 1); // refresh a → b becomes LRU
    cache.set("c", 3, 2);
    expect(cache.get("a", 3)).toBe(1);
    expect(cache.get("b", 3)).toBeUndefined();
    expect(cache.get("c", 3)).toBe(3);
  });
});

/** In-memory stand-in for the Postgres cell cache. */
function fakeRepo(): PlacesCacheRepo & { rows: Map<string, CachedCell>; reads: number } {
  const rows = new Map<string, CachedCell>();
  return {
    rows,
    reads: 0,
    async get(key) {
      this.reads++;
      return rows.get(key) ?? null;
    },
    async put(key, cell) {
      rows.set(key, { ...cell, fetchedAt: new Date() });
    },
    async prune() {
      return 0;
    },
  };
}

describe("GET /api/places/masjids", () => {
  let server: Server;
  let base: string;

  async function startServer(
    apiKey: string | undefined,
    opts: {
      embedKey?: string;
      cacheRepo?: PlacesCacheRepo;
      resident?: ResidentIndex;
      governor?: PlacesGovernor;
    } = {},
  ): Promise<void> {
    const app = express();
    app.use(
      createPlacesRouter({
        apiKey,
        embedKey: opts.embedKey,
        cacheRepo: opts.cacheRepo,
        resident: opts.resident,
        governor: opts.governor,
      }),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  async function stopServer(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  beforeEach(() => {
    mockSearch.mockReset();
    mockTravel.mockReset();
  });

  afterAll(async () => {
    await stopServer();
  });

  it("no key configured → 200 { enabled: false } without calling upstream", async () => {
    await startServer(undefined);
    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, masjids: [] });
    expect(mockSearch).not.toHaveBeenCalled();
    await stopServer();
  });

  it("bad input → 400 + issues", async () => {
    await startServer("key");
    const res = await fetch(`${base}/api/places/masjids?lat=999&lon=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.issues)).toBe(true);
    await stopServer();
  });

  it("NEVER prices travel times for the list — that is the whole ADR-014 saving", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([MASJID]);
    await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(mockTravel).not.toHaveBeenCalled();
    await stopServer();
  });

  it("searches at the CELL CENTRE, not the caller — that is what makes an entry shareable", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([MASJID]);
    await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);

    const [lat, lon] = mockSearch.mock.calls[0]!;
    expect(lat).toBeCloseTo(33.32, 6);
    expect(lon).toBeCloseTo(44.37, 6);
    expect(lat).not.toBe(BAGHDAD.lat);
    await stopServer();
  });

  it("happy path → masjids with a free estimate, and caches the cell", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([MASJID]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, masjids: [SERVED] });

    // Second request from the same cell → served from cache, no second call.
    const res2 = await fetch(
      `${base}/api/places/masjids?lat=${BAGHDAD.lat + 0.0001}&lon=${BAGHDAD.lon}`,
    );
    expect((await res2.json()).masjids).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await stopServer();
  });

  it("ranks by the caller's true distance, not by the cell centre", async () => {
    await startServer("key");
    const near: Masjid = { ...MASJID, id: "near", name: "قريب", lat: 33.3155, lon: 44.3665 };
    const far: Masjid = { ...MASJID, id: "far", name: "بعيد", lat: 33.372, lon: 44.355 };
    // Upstream order is deliberately "far first" — the server must re-sort.
    mockSearch.mockResolvedValue([far, near]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    const body = await res.json();
    expect(body.masjids.map((m: Masjid) => m.id)).toEqual(["near", "far"]);
    expect(body.masjids[0].walkMin).toBeLessThan(body.masjids[1].walkMin);
    await stopServer();
  });

  it("marks list times as estimates so the UI can label them", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([MASJID]);
    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect((await res.json()).masjids[0].estimated).toBe(true);
    await stopServer();
  });

  it("embedKey is echoed only when configured", async () => {
    await startServer("key", { embedKey: "embed-key" });
    mockSearch.mockResolvedValue([MASJID]);
    const res = await fetch(`${base}/api/places/masjids?lat=31&lon=44`);
    expect((await res.json()).embedKey).toBe("embed-key");
    await stopServer();

    await startServer("key");
    mockSearch.mockResolvedValue([MASJID]);
    const res2 = await fetch(`${base}/api/places/masjids?lat=31&lon=44`);
    expect((await res2.json()).embedKey).toBeUndefined();
    await stopServer();
  });

  it("upstream failure → 200 degraded, NOT cached (next request retries)", async () => {
    await startServer("key");
    mockSearch.mockResolvedValueOnce(null).mockResolvedValueOnce([MASJID]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(await res.json()).toEqual({ enabled: true, masjids: [], degraded: true });

    const res2 = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(await res2.json()).toEqual({ enabled: true, masjids: [SERVED] });
    expect(mockSearch).toHaveBeenCalledTimes(2);
    await stopServer();
  });

  it("genuine empty area → { enabled: true, masjids: [] } without degraded flag", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([]);
    const res = await fetch(`${base}/api/places/masjids?lat=0&lon=-160`);
    expect(await res.json()).toEqual({ enabled: true, masjids: [] });
    await stopServer();
  });

  it("reads the durable cache before spending, and writes to it after", async () => {
    const repo = fakeRepo();
    await startServer("key", { cacheRepo: repo });
    mockSearch.mockResolvedValue([MASJID]);

    await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(repo.rows.size).toBe(1);
    expect(repo.rows.get(gridKey(BAGHDAD.lat, BAGHDAD.lon))?.masjids).toEqual([MASJID]);
    await stopServer();
  });

  it("a warm durable cache survives a restart — a fresh router spends nothing", async () => {
    const repo = fakeRepo();
    await repo.put(gridKey(BAGHDAD.lat, BAGHDAD.lon), {
      masjids: [MASJID],
      resultCount: 1,
      maxDistKm: 6.4,
    });

    // Fresh router = fresh process memory, exactly like a redeploy.
    await startServer("key", { cacheRepo: repo });
    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect((await res.json()).masjids).toEqual([SERVED]);
    expect(mockSearch).not.toHaveBeenCalled();
    await stopServer();
  });

  it("a saturated cached cell that cannot vouch for the caller triggers a fresh search", async () => {
    const repo = fakeRepo();
    // 20 results all packed within 300 m of the cell centre — cannot vouch for
    // a caller most of a kilometre away.
    await repo.put(gridKey(BAGHDAD.lat, BAGHDAD.lon), {
      masjids: [MASJID],
      resultCount: MAX_RESULTS,
      maxDistKm: 0.3,
    });
    await startServer("key", { cacheRepo: repo });
    mockSearch.mockResolvedValue([MASJID]);

    await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await stopServer();
  });

  it("a well-mapped area is answered from the FREE resident data, with no Google call", async () => {
    const resident = ResidentIndex.fromRows([
      { n: "جامع الرحمن", lat: BAGHDAD.lat + 0.001, lon: BAGHDAD.lon, oid: "n1" },
      { n: "مسجد الهدى", lat: BAGHDAD.lat + 0.003, lon: BAGHDAD.lon, oid: "n2" },
      { n: "جامع بلال", lat: BAGHDAD.lat + 0.006, lon: BAGHDAD.lon, oid: "n3" },
    ]);
    await startServer("key", { resident });
    mockSearch.mockResolvedValue([MASJID]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    const body = await res.json();
    expect(mockSearch).not.toHaveBeenCalled();
    expect(body.masjids.map((m: Masjid) => m.name)).toContain("جامع الرحمن");
    expect(body.degraded).toBeUndefined();
    await stopServer();
  });

  it("a SPARSE resident area still goes to Google — coverage gaps are not hidden", async () => {
    const resident = ResidentIndex.fromRows([
      { n: "وحيد", lat: BAGHDAD.lat + 0.001, lon: BAGHDAD.lon, oid: "n1" },
    ]);
    await startServer("key", { resident });
    mockSearch.mockResolvedValue([MASJID]);

    await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await stopServer();
  });

  it("merges resident and Google results instead of choosing one", async () => {
    const resident = ResidentIndex.fromRows([
      { n: "وحيد", lat: BAGHDAD.lat + 0.001, lon: BAGHDAD.lon, oid: "n1" },
    ]);
    await startServer("key", { resident });
    mockSearch.mockResolvedValue([MASJID]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    const names = (await res.json()).masjids.map((m: Masjid) => m.name);
    expect(names).toContain("وحيد"); // resident
    expect(names).toContain(MASJID.name); // Google
    await stopServer();
  });

  it("keeps serving free resident masjids when the budget is exhausted", async () => {
    const resident = ResidentIndex.fromRows([
      { n: "جامع الرحمن", lat: BAGHDAD.lat + 0.001, lon: BAGHDAD.lon, oid: "n1" },
    ]);
    await startServer("key", { resident, governor: fakeGovernor(false).governor });
    mockSearch.mockResolvedValue([MASJID]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    // Degraded, but the user still gets a real, usable list — the whole point.
    expect(body.masjids.map((m: Masjid) => m.name)).toEqual(["جامع الرحمن"]);
    await stopServer();
  });

  it("budget breaker: a masjid miss now costs 1 unit, so the 31st distinct cell degrades", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([]);
    // 0.02° steps > the 0.01° cell — every request is a fresh miss, the attack
    // shape the breaker exists for (security review 2026-07-14).
    for (let i = 0; i < 30; i++) {
      const res = await fetch(
        `${base}/api/places/masjids?lat=${(10 + i * 0.02).toFixed(4)}&lon=44`,
      );
      expect((await res.json()).degraded).toBeUndefined();
    }
    const res31 = await fetch(`${base}/api/places/masjids?lat=${(10 + 30 * 0.02).toFixed(4)}&lon=44`);
    expect(await res31.json()).toEqual({ enabled: true, masjids: [], degraded: true });
    expect(mockSearch).toHaveBeenCalledTimes(30);
    await stopServer();
  });

  it("a refused spend still serves the best free answer it has, rather than an empty screen", async () => {
    const repo = fakeRepo();
    // Stale-but-present entry that cannot vouch for this caller.
    await repo.put(gridKey(BAGHDAD.lat, BAGHDAD.lon), {
      masjids: [MASJID],
      resultCount: MAX_RESULTS,
      maxDistKm: 0.3,
    });
    await startServer("key", { cacheRepo: repo });
    mockSearch.mockResolvedValue([]);

    // Burn the whole minute budget on other cells.
    for (let i = 0; i < 30; i++) {
      await fetch(`${base}/api/places/masjids?lat=${(10 + i * 0.02).toFixed(4)}&lon=44`);
    }

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.masjids).toEqual([SERVED]); // degraded, but NOT empty
    await stopServer();
  });
});

/** Governor stand-in: records what it was asked, answers as configured. */
function fakeGovernor(allow: boolean, reason: DenyReason = "denied_budget") {
  const opened: Array<{ clientId: string; ipKey: string }> = [];
  let spends = 0;
  const governor: PlacesGovernor = {
    async open(clientId, ipKey) {
      opened.push({ clientId, ipKey });
      let denied: DenyReason | undefined;
      let committed = 0;
      return {
        day: "2026-07-25",
        hour: 12,
        deniedReason: () => denied,
        spent: () => committed,
        async spend(units) {
          spends++;
          if (!allow) {
            denied = reason;
            return false;
          }
          committed += units;
          return true;
        },
      };
    },
    async plan() {
      return {
        dailyPool: 150,
        reserve: 30,
        perClientCap: 5,
        perIpCap: 15,
        usedThisMonth: 42,
        activeClients: 7,
      };
    },
  };
  return {
    governor,
    opened,
    spendCount: () => spends,
  };
}

function fakeStats() {
  const outcomes: Array<{ outcome: PlacesOutcome; units: number }> = [];
  const cells: Array<{ cellKey: string; miss: boolean }> = [];
  const recorder: PlacesStatsRecorder = {
    noteOutcome: (_d, _h, outcome, units) => void outcomes.push({ outcome, units }),
    noteCell: (_d, cellKey, miss) => void cells.push({ cellKey, miss }),
    flush: async () => undefined,
    start: () => undefined,
    stop: () => undefined,
  };
  return { recorder, outcomes, cells };
}

describe("spend governor + telemetry", () => {
  let server: Server;
  let base: string;

  async function start(deps: Parameters<typeof createPlacesRouter>[0]): Promise<void> {
    const app = express();
    app.use(createPlacesRouter(deps));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }
  async function stop(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const masjidUrl = (): string =>
    `${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`;

  beforeEach(() => {
    mockSearch.mockReset();
    mockTravel.mockReset();
  });

  it("records EVERY request, including the free ones that never touch Google", async () => {
    const g = fakeGovernor(true);
    const s = fakeStats();
    await start({ apiKey: "key", governor: g.governor, stats: s.recorder });
    mockSearch.mockResolvedValue([MASJID]);

    await fetch(masjidUrl()); // live
    await fetch(masjidUrl()); // served from the memory cell — costs nothing

    expect(mockSearch).toHaveBeenCalledTimes(1);
    // …but BOTH were recorded, which is what makes the active-client count real.
    expect(s.outcomes).toEqual([
      { outcome: "live", units: 1 },
      { outcome: "cache_mem", units: 0 },
    ]);
    expect(g.opened).toHaveLength(2);
    await stop();
  });

  it("marks cell demand as a miss only when Google was actually called", async () => {
    const s = fakeStats();
    await start({ apiKey: "key", governor: fakeGovernor(true).governor, stats: s.recorder });
    mockSearch.mockResolvedValue([MASJID]);

    await fetch(masjidUrl());
    await fetch(masjidUrl());

    const cell = gridKey(BAGHDAD.lat, BAGHDAD.lon);
    expect(s.cells).toEqual([
      { cellKey: cell, miss: true },
      { cellKey: cell, miss: false },
    ]);
    await stop();
  });

  it("a governor denial degrades gracefully and is recorded with its reason", async () => {
    const s = fakeStats();
    await start({
      apiKey: "key",
      governor: fakeGovernor(false, "denied_client").governor,
      stats: s.recorder,
    });
    mockSearch.mockResolvedValue([MASJID]);

    const res = await fetch(masjidUrl());
    expect(await res.json()).toEqual({ enabled: true, masjids: [], degraded: true });
    expect(mockSearch).not.toHaveBeenCalled(); // nothing was spent
    expect(s.outcomes).toEqual([{ outcome: "denied_client", units: 0 }]);
    await stop();
  });

  it("passes the app's anonymous id through, and falls back to the IP prefix", async () => {
    const g = fakeGovernor(true);
    await start({ apiKey: "key", governor: g.governor });
    mockSearch.mockResolvedValue([MASJID]);

    await fetch(masjidUrl(), {
      headers: { "X-Client-Id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301", "CF-Connecting-IP": "5.6.7.8" },
    });
    expect(g.opened[0]).toEqual({
      clientId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      ipKey: "5.6.7.0/24",
    });

    await fetch(`${base}/api/places/masjids?lat=34&lon=44`, {
      headers: { "CF-Connecting-IP": "5.6.7.8" },
    });
    expect(g.opened[1]!.clientId).toBe("ip:5.6.7.0/24");
    await stop();
  });

  it("still works with no governor at all (stateless boot)", async () => {
    await start({ apiKey: "key" });
    mockSearch.mockResolvedValue([MASJID]);
    const res = await fetch(masjidUrl());
    expect((await res.json()).masjids).toHaveLength(1);
    await stop();
  });
});

describe("POST /api/places/masjids/contribute", () => {
  let server: Server;
  let base: string;

  function fakeContributions(accept = true) {
    const received: Array<{ name: string; lat: number; lon: number; clientId: string }> = [];
    const repo: MasjidContributionsRepo = {
      async submit(input) {
        received.push(input);
        return accept;
      },
      async approved() {
        return [];
      },
      // Moderation surface — exercised by the admin tests, not this file.
      async listByStatus() {
        return [];
      },
      async counts() {
        return { pending: 0, approved: 0, rejected: 0 };
      },
      async update() {
        return null;
      },
    };
    return { repo, received };
  }

  async function start(contributions?: MasjidContributionsRepo): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(createPlacesRouter({ apiKey: "key", contributions }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }
  async function stop(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  function post(body: unknown, headers: Record<string, string> = {}): Promise<globalThis.Response> {
    return fetch(`${base}/api/places/masjids/contribute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  const VALID = {
    name: "جامع الحي",
    lat: 33.3152,
    lon: 44.3661,
    userLat: 33.3152,
    userLon: 44.3661,
  };

  it("accepts a masjid at the submitter's own position", async () => {
    const c = fakeContributions();
    await start(c.repo);
    const res = await post(VALID, { "X-Client-Id": "3f2504e0-4f89-11d3-9a0c-0305e82c3301" });
    expect(res.status).toBe(201);
    expect(c.received[0]).toMatchObject({
      name: "جامع الحي",
      clientId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    });
    await stop();
  });

  it("rejects a pin dropped on the other side of the world", async () => {
    const c = fakeContributions();
    await start(c.repo);
    const res = await post({ ...VALID, lat: -33, lon: 151 }); // Sydney
    expect(res.status).toBe(400);
    expect(c.received).toHaveLength(0);
    await stop();
  });

  it("rejects an empty or over-long name", async () => {
    await start(fakeContributions().repo);
    expect((await post({ ...VALID, name: "" })).status).toBe(400);
    expect((await post({ ...VALID, name: "x".repeat(200) })).status).toBe(400);
    await stop();
  });

  it("rejects nonsense coordinates", async () => {
    await start(fakeContributions().repo);
    expect((await post({ ...VALID, lat: 999 })).status).toBe(400);
    expect((await post({ name: "جامع" })).status).toBe(400);
    await stop();
  });

  it("trims the name rather than storing the user's stray spaces", async () => {
    const c = fakeContributions();
    await start(c.repo);
    await post({ ...VALID, name: "   جامع الحي   " });
    expect(c.received[0]!.name).toBe("جامع الحي");
    await stop();
  });

  it("surfaces the daily cap as 429 so the UI can explain it", async () => {
    await start(fakeContributions(false).repo);
    expect((await post(VALID)).status).toBe(429);
    await stop();
  });

  it("503s when the store isn't configured, rather than pretending it worked", async () => {
    await start(undefined);
    expect((await post(VALID)).status).toBe(503);
    await stop();
  });
});

describe("GET /api/places/usage", () => {
  let server: Server;
  let base: string;

  async function start(deps: Parameters<typeof createPlacesRouter>[0]): Promise<void> {
    const app = express();
    app.use(createPlacesRouter(deps));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }
  async function stop(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const TOKEN = "a-sufficiently-long-admin-token";

  it("404s when no token is configured — the route doesn't advertise itself", async () => {
    await start({ apiKey: "key", governor: fakeGovernor(true).governor });
    expect((await fetch(`${base}/api/places/usage`)).status).toBe(404);
    await stop();
  });

  it("404s on a wrong token", async () => {
    await start({ apiKey: "key", governor: fakeGovernor(true).governor, adminToken: TOKEN });
    expect((await fetch(`${base}/api/places/usage?token=nope`)).status).toBe(404);
    await stop();
  });

  it("reports the live plan to an operator with the token", async () => {
    await start({ apiKey: "key", governor: fakeGovernor(true).governor, adminToken: TOKEN });
    const res = await fetch(`${base}/api/places/usage?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      enabled: true,
      dailyPool: 150,
      perClientCap: 5,
      perIpCap: 15,
      usedThisMonth: 42,
      activeClients: 7,
    });
    expect(typeof body.billingDay).toBe("string");
    await stop();
  });
});

describe("GET /api/places/travel", () => {
  let server: Server;
  let base: string;

  async function startServer(apiKey: string | undefined): Promise<void> {
    const app = express();
    app.use(createPlacesRouter({ apiKey }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  async function stopServer(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const url = (): string =>
    `${base}/api/places/travel?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}&dlat=${MASJID.lat}&dlon=${MASJID.lon}`;

  beforeEach(() => {
    mockSearch.mockReset();
    mockTravel.mockReset();
  });

  it("no key → { enabled: false }", async () => {
    await startServer(undefined);
    const res = await fetch(url());
    expect(await res.json()).toEqual({ enabled: false, walkMin: null, driveMin: null });
    expect(mockTravel).not.toHaveBeenCalled();
    await stopServer();
  });

  it("bad input → 400", async () => {
    await startServer("key");
    const res = await fetch(`${base}/api/places/travel?lat=33&lon=44&dlat=999&dlon=44`);
    expect(res.status).toBe(400);
    await stopServer();
  });

  it("records an outcome for a travel request too — every request is counted", async () => {
    const s = fakeStats();
    const app = express();
    app.use(
      createPlacesRouter({ apiKey: "key", governor: fakeGovernor(true).governor, stats: s.recorder }),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
    mockTravel.mockResolvedValue([{ walkMin: 62, driveMin: 11 }]);

    await fetch(url()); // paid
    await fetch(url()); // served from the travel cache

    expect(s.outcomes).toEqual([
      { outcome: "travel_live", units: 2 },
      { outcome: "travel_cached", units: 0 },
    ]);
    await stopServer();
  });

  it("returns REAL times for one masjid and caches them", async () => {
    await startServer("key");
    mockTravel.mockResolvedValue([{ walkMin: 62, driveMin: 11 }]);

    const res = await fetch(url());
    expect(await res.json()).toEqual({ enabled: true, walkMin: 62, driveMin: 11 });

    // Re-expanding the same row costs nothing.
    const res2 = await fetch(url());
    expect(await res2.json()).toEqual({ enabled: true, walkMin: 62, driveMin: 11 });
    expect(mockTravel).toHaveBeenCalledTimes(1);
    await stopServer();
  });

  it("asks Google for exactly ONE destination", async () => {
    await startServer("key");
    mockTravel.mockResolvedValue([{ walkMin: 62, driveMin: 11 }]);
    await fetch(url());
    const [, points] = mockTravel.mock.calls[0]!;
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ lat: MASJID.lat, lon: MASJID.lon });
    await stopServer();
  });

  it("upstream failure → degraded, not cached, and the client keeps its estimate", async () => {
    await startServer("key");
    mockTravel.mockResolvedValueOnce(null).mockResolvedValueOnce([{ walkMin: 62, driveMin: 11 }]);

    const res = await fetch(url());
    expect(await res.json()).toEqual({
      enabled: true,
      walkMin: null,
      driveMin: null,
      degraded: true,
    });

    const res2 = await fetch(url());
    expect(await res2.json()).toEqual({ enabled: true, walkMin: 62, driveMin: 11 });
    await stopServer();
  });
});
