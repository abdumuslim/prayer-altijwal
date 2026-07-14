import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CitiesIndex } from "./cities-index.js";
import { createGeoRouter } from "./routes.js";
import { declinationDeg } from "./declination.js";

// Official WMM-2025 test values (NOAA/NCEI, shipped in geomagnetism's test
// set): decimal year 2025.0, altitude in km above the ellipsoid.
const WMM2025_EPOCH = new Date(Date.UTC(2025, 0, 1));
const OFFICIAL = [
  { alt: 65, lat: 43, lon: 93, decl: 0.5 },
  { alt: 39, lat: -59, lon: -8, decl: -15.75 },
  { alt: 51, lat: -33, lon: 109, decl: -5.49 },
];

describe("declinationDeg — WMM-2025 official test values", () => {
  for (const v of OFFICIAL) {
    it(`lat ${v.lat}, lon ${v.lon}, alt ${v.alt} km → ${v.decl}°`, () => {
      expect(declinationDeg(v.lat, v.lon, WMM2025_EPOCH, v.alt)).toBeCloseTo(v.decl, 1);
    });
  }

  it("Baghdad mid-2026 ≈ +4.5–5.5°E at ground level (NOAA ballpark)", () => {
    const d = declinationDeg(33.3152, 44.3661, new Date(Date.UTC(2026, 6, 14)));
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(6);
  });

  it("degrades past the model window instead of throwing (stale beats none)", () => {
    expect(() => declinationDeg(33.3, 44.4, new Date(Date.UTC(2031, 0, 1)))).not.toThrow();
  });
});

describe("GET /api/geo/declination", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(createGeoRouter(CitiesIndex.load()));
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

  it("returns { declinationDeg } for valid coordinates", async () => {
    const res = await fetch(`${base}/api/geo/declination?lat=33.3152&lon=44.3661`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.declinationDeg).toBe("number");
    expect(body.declinationDeg).toBeGreaterThan(3);
    expect(body.declinationDeg).toBeLessThan(7);
  });

  it("bad input → 400 + issues", async () => {
    const res = await fetch(`${base}/api/geo/declination?lat=999&lon=0`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.issues)).toBe(true);
  });
});
