import { describe, it, expect } from "vitest";
import { IRAQ_BBOX, isInIraqBbox } from "./iraq-bbox";
import { IRAQ_BBOX as SERVER_IRAQ_BBOX } from "../../../server/src/places/iraq-bbox.js";

// The client copy MUST stay identical to the server constant
// (server/src/places/iraq-bbox.ts): the nearest-masjids section is hidden for
// any location outside this box, and the server enforces the same geofence.
describe("isInIraqBbox", () => {
  it("accepts locations inside Iraq", () => {
    expect(isInIraqBbox(33.3152, 44.3661)).toBe(true); // Baghdad
    expect(isInIraqBbox(36.34, 43.13)).toBe(true); // Mosul
    expect(isInIraqBbox(30.5, 47.8)).toBe(true); // Basra
  });

  it("rejects locations outside Iraq, where the section is hidden", () => {
    expect(isInIraqBbox(40.7128, -74.006)).toBe(false); // New York
    expect(isInIraqBbox(24.7136, 46.6753)).toBe(false); // Riyadh
    expect(isInIraqBbox(41.0082, 28.9784)).toBe(false); // Istanbul
  });

  it("mirrors the server bbox values", () => {
    // Import the server constant directly (client tests can reach server source,
    // see src/native/schedule.ts) so a server-side bbox change fails this test
    // instead of silently drifting from a second literal.
    expect(IRAQ_BBOX).toEqual(SERVER_IRAQ_BBOX);
  });

  it("rejects non-finite input", () => {
    expect(isInIraqBbox(Number.NaN, 44)).toBe(false);
    expect(isInIraqBbox(33, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
