import { describe, it, expect } from "vitest";
import { estimateTravel, WALK_KMH, DRIVE_KMH, DETOUR_FACTOR } from "./travel-estimate.js";

/**
 * The estimate replaces an eager Routes API call on every cache miss (10 billed
 * elements). It only has to be honest to the nearest minute or two — a masjid
 * 400 m away is "a few minutes' walk" whichever way you measure it.
 */
describe("estimateTravel", () => {
  it("scales straight-line distance by the detour factor at the walking speed", () => {
    // 1 km straight line → 1.3 km walked → 1.3 / 5 km/h = 15.6 min
    expect(estimateTravel(1).walkMin).toBe(16);
  });

  it("scales straight-line distance by the detour factor at the driving speed", () => {
    // 5 km straight line → 6.5 km driven → 6.5 / 30 km/h = 13 min
    expect(estimateTravel(5).driveMin).toBe(13);
  });

  it("never reports zero minutes — '0 min away' reads as broken", () => {
    const nextDoor = estimateTravel(0.01);
    expect(nextDoor.walkMin).toBe(1);
    expect(nextDoor.driveMin).toBe(1);
  });

  it("treats a zero distance as one minute rather than dividing to nothing", () => {
    expect(estimateTravel(0)).toEqual({ walkMin: 1, driveMin: 1 });
  });

  it("is defensive about garbage input (NaN, Infinity, negative)", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const out = estimateTravel(bad);
      expect(out.walkMin).toBe(1);
      expect(out.driveMin).toBe(1);
    }
  });

  it("keeps walking slower than driving for any real distance", () => {
    for (const km of [0.2, 0.5, 1, 2.5, 5]) {
      const { walkMin, driveMin } = estimateTravel(km);
      expect(walkMin).toBeGreaterThanOrEqual(driveMin);
    }
  });

  it("exposes the constants so the docs and the UI copy cannot drift from the code", () => {
    expect(WALK_KMH).toBe(5);
    expect(DRIVE_KMH).toBe(30);
    expect(DETOUR_FACTOR).toBe(1.3);
  });
});
