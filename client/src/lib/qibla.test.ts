import { describe, it, expect } from "vitest";
import { bearingToKaaba, distanceToKaabaKm, initialBearing } from "./qibla";

/**
 * Reference qibla bearings (degrees CW from TRUE north), cross-checked against
 * published great-circle qibla values (Google Qibla Finder / Accurate Times
 * class sources). Tolerance ±0.5° per docs/QIBLA_MASJID_SPEC.md §5a.
 */
const REFERENCE = [
  { city: "Baghdad", lat: 33.3152, lon: 44.3661, bearing: 199.8 },
  { city: "Istanbul", lat: 41.0082, lon: 28.9784, bearing: 151.6 },
  { city: "Cairo", lat: 30.0444, lon: 31.2357, bearing: 136.1 },
  { city: "New York", lat: 40.7128, lon: -74.006, bearing: 58.5 },
  { city: "Jakarta", lat: -6.2088, lon: 106.8456, bearing: 295.1 },
  { city: "London", lat: 51.5074, lon: -0.1278, bearing: 119.0 },
];

describe("bearingToKaaba — reference cities (±0.5°)", () => {
  for (const r of REFERENCE) {
    it(`${r.city} → ≈${r.bearing}°`, () => {
      const b = bearingToKaaba(r.lat, r.lon);
      expect(Math.abs(b - r.bearing)).toBeLessThan(0.5);
    });
  }

  it("is normalized to [0, 360)", () => {
    for (const r of REFERENCE) {
      const b = bearingToKaaba(r.lat, r.lon);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });

  it("at the Kaaba's own longitude, points due south from the north", () => {
    // Same meridian, north of Mecca → initial bearing exactly 180°.
    expect(initialBearing(30, 39.826206, 21.422487, 39.826206)).toBeCloseTo(180, 5);
  });
});

describe("distanceToKaabaKm", () => {
  it("Baghdad → ≈1394 km (the spec's UI example)", () => {
    const km = distanceToKaabaKm(33.3152, 44.3661);
    expect(Math.abs(km - 1394)).toBeLessThan(15);
  });

  it("zero at the Kaaba itself", () => {
    expect(distanceToKaabaKm(21.422487, 39.826206)).toBeCloseTo(0, 6);
  });
});
