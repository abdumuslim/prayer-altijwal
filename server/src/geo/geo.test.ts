import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CitiesIndex } from "./cities-index.js";
import { openMeteoSearch } from "./open-meteo.js";
import { createGeoRouter } from "./routes.js";

// Real coordinates for assertions.
const BAGHDAD = { lat: 33.32, lon: 44.36 };
const MOSUL = { lat: 36.34, lon: 43.12 };

// Loaded once; requires `npm run build:cities` to have produced the JSON.
let index: CitiesIndex;

beforeAll(() => {
  index = CitiesIndex.load();
});

describe("CitiesIndex — dataset load", () => {
  it("loads a non-trivial number of cities", () => {
    expect(index.size).toBeGreaterThan(20000);
  });
});

describe("CitiesIndex.reverse — GPS → nearest city", () => {
  it("near Baghdad → IQ / Asia/Baghdad", () => {
    const c = index.reverse(BAGHDAD.lat, BAGHDAD.lon);
    expect(c).not.toBeNull();
    expect(c?.cc).toBe("IQ");
    expect(c?.tz).toBe("Asia/Baghdad");
  });

  it("near Mosul → IQ", () => {
    const c = index.reverse(MOSUL.lat, MOSUL.lon);
    expect(c).not.toBeNull();
    expect(c?.cc).toBe("IQ");
  });

  it("falls back to a full scan for remote coordinates (mid-ocean)", () => {
    const c = index.reverse(0, -160); // empty Pacific, no nearby band
    expect(c).not.toBeNull();
  });
});

describe("CitiesIndex.search — forward city search", () => {
  it('"mecca" returns a Saudi result (matched via alternate name)', () => {
    const hits = index.search("mecca");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((c) => c.cc === "SA")).toBe(true);
  });

  it("is diacritic-insensitive (zurich matches Zürich)", () => {
    const plain = index.search("zurich");
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.some((c) => c.cc === "CH")).toBe(true);

    const accented = index.search("zürich");
    expect(accented.length).toBeGreaterThan(0);
    expect(accented.some((c) => c.cc === "CH")).toBe(true);
  });

  it("is case-insensitive and ranks by population", () => {
    const hits = index.search("LONDON");
    expect(hits.length).toBeGreaterThan(0);
    // The most populous London (GB) should rank first.
    expect(hits[0].cc).toBe("GB");
  });

  it("returns [] for blank input and respects the limit", () => {
    expect(index.search("   ")).toEqual([]);
    expect(index.search("a", 3).length).toBeLessThanOrEqual(3);
  });
});

describe("openMeteoSearch — never throws", () => {
  it("returns [] for blank input without hitting the network", async () => {
    expect(await openMeteoSearch("", "en")).toEqual([]);
  });
});

describe("createGeoRouter — HTTP routes", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(createGeoRouter(index));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address() as AddressInfo;
        base = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/geo/reverse near Baghdad → IQ, Asia/Baghdad, method BaghdadYMA", async () => {
    const res = await fetch(`${base}/api/geo/reverse?lat=${BAGHDAD.lat}&lon=${BAGHDAD.lon}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.country).toBe("IQ");
    expect(body.tz).toBe("Asia/Baghdad");
    expect(body.method).toBe("BaghdadYMA");
    expect(typeof body.city).toBe("string");
  });

  it("GET /api/geo/reverse near Mosul → IQ, calibrated Iraqi profile country-wide", async () => {
    const res = await fetch(`${base}/api/geo/reverse?lat=${MOSUL.lat}&lon=${MOSUL.lon}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.country).toBe("IQ");
    expect(body.method).toBe("BaghdadYMA");
  });

  it("GET /api/geo/reverse with bad input → 400 + issues", async () => {
    const res = await fetch(`${base}/api/geo/reverse?lat=999&lon=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("GET /api/geo/search?q=mecca → Saudi result in the expected shape", async () => {
    const res = await fetch(`${base}/api/geo/search?q=mecca`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    const sa = body.results.find((x: { country: string }) => x.country === "SA");
    expect(sa).toBeTruthy();
    expect(sa).toHaveProperty("name");
    expect(sa).toHaveProperty("tz");
    expect(sa).toHaveProperty("lat");
    expect(sa).toHaveProperty("lon");
    expect(sa).toHaveProperty("elevation");
    expect(sa).toHaveProperty("population");
  });

  it("GET /api/geo/search with empty q → 400", async () => {
    const res = await fetch(`${base}/api/geo/search?q=`);
    expect(res.status).toBe(400);
  });

  it("GET /api/geo/governorates?country=IQ → governorate capitals with Arabic names", async () => {
    const res = await fetch(`${base}/api/geo/governorates?country=IQ`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.governorates)).toBe(true);
    expect(body.governorates.length).toBeGreaterThan(5);
    const baghdad = body.governorates.find((g: { name: string }) => /Baghdad/i.test(g.name));
    expect(baghdad).toBeTruthy();
    expect(baghdad.nameAr).toBe("بغداد");
    expect(baghdad.tz).toBe("Asia/Baghdad");
  });

  it("GET /api/geo/governorates with bad country → 400", async () => {
    const res = await fetch(`${base}/api/geo/governorates?country=IRAQ`);
    expect(res.status).toBe(400);
  });
});
