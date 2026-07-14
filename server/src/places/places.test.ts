import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gridKey, TtlLruCache } from "./cache.js";
import { createPlacesRouter } from "./routes.js";
import { searchNearbyMasjids, type Masjid } from "./google-places.js";

// The router is tested against a mocked upstream so the in-process server can
// be hit with the real (local) fetch, matching the geo.test.ts pattern.
vi.mock("./google-places.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./google-places.js")>();
  return { ...actual, searchNearbyMasjids: vi.fn() };
});
const mockSearch = vi.mocked(searchNearbyMasjids);

const BAGHDAD = { lat: 33.3152, lon: 44.3661 };
const MASJID: Masjid = {
  id: "place-1",
  name: "جامع الإمام الأعظم",
  lat: 33.372,
  lon: 44.355,
  address: "الأعظمية، بغداد",
};

describe("gridKey", () => {
  it("groups points within ~300 m into one cell", () => {
    expect(gridKey(33.3152, 44.3661)).toBe(gridKey(33.3153, 44.3662));
  });

  it("separates points a few km apart", () => {
    expect(gridKey(33.3152, 44.3661)).not.toBe(gridKey(33.35, 44.4));
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

describe("GET /api/places/masjids", () => {
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

  beforeEach(() => {
    mockSearch.mockReset();
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

  it("happy path → { enabled: true, masjids } and caches the grid cell", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([MASJID]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, masjids: [MASJID] });

    // Second request from the same ~300 m cell → served from cache, one upstream call.
    const res2 = await fetch(
      `${base}/api/places/masjids?lat=${BAGHDAD.lat + 0.0001}&lon=${BAGHDAD.lon}`,
    );
    expect((await res2.json()).masjids).toEqual([MASJID]);
    expect(mockSearch).toHaveBeenCalledTimes(1);
    await stopServer();
  });

  it("upstream failure → 200 degraded, NOT cached (next request retries)", async () => {
    await startServer("key");
    mockSearch.mockResolvedValueOnce(null).mockResolvedValueOnce([MASJID]);

    const res = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(await res.json()).toEqual({ enabled: true, masjids: [], degraded: true });

    const res2 = await fetch(`${base}/api/places/masjids?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(await res2.json()).toEqual({ enabled: true, masjids: [MASJID] });
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

  it("upstream budget breaker: 31st distinct-cell request degrades without calling Google", async () => {
    await startServer("key");
    mockSearch.mockResolvedValue([]);
    // 0.01° steps > the 0.003° grid — every request is a fresh cache miss,
    // the attack shape the breaker exists for (security review 2026-07-14).
    for (let i = 0; i < 30; i++) {
      const res = await fetch(
        `${base}/api/places/masjids?lat=${(10 + i * 0.01).toFixed(4)}&lon=44`,
      );
      const body = await res.json();
      expect(body.degraded).toBeUndefined();
    }
    const res31 = await fetch(`${base}/api/places/masjids?lat=${(10 + 0.3).toFixed(4)}&lon=44`);
    expect(await res31.json()).toEqual({ enabled: true, masjids: [], degraded: true });
    expect(mockSearch).toHaveBeenCalledTimes(30);
    await stopServer();
  });
});
