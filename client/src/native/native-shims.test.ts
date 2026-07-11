// Direct coverage for the two browser-only shims that the parity test (which runs
// in node and hits the server's fs-based loader) does not exercise:
//   - node-module-shim: the engine's astronomy-engine loader,
//   - iraq-calibration-browser: the ESM-JSON calibration binding.
// Both must be byte-faithful to the server path (docs/NATIVE_ALARM_SPEC.md §3b).

import { describe, it, expect } from "vitest";
import { createRequire } from "./node-module-shim";
import * as browserCal from "./iraq-calibration-browser";
import * as serverCal from "../../../server/src/prayer/iraq-calibration.js";
import type { TimeName } from "../../../server/src/prayer-engine/index.js";

const ORDER: TimeName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
// Baghdad + Basra capitals (matching iraq-governorates.test.ts).
const POINTS = [
  { name: "Baghdad", lat: 33.34058, lon: 44.40088 },
  { name: "Basra", lat: 30.5085, lon: 47.7804 },
];

describe("node-module-shim exposes astronomy-engine", () => {
  it("resolves the astronomy-engine API and rejects other ids", () => {
    const req = createRequire("file:///x");
    const ae = req("astronomy-engine") as Record<string, unknown>;
    expect(typeof ae.Observer).toBe("function");
    expect(typeof ae.Body).not.toBe("undefined");
    expect(() => req("fs")).toThrow();
  });
});

describe("iraq-calibration-browser matches the server loader", () => {
  it.each(POINTS)("$name calibration is identical to the fs loader", (pt) => {
    const b = browserCal.iraqCalibration(pt.lat, pt.lon);
    const s = serverCal.iraqCalibration(pt.lat, pt.lon);
    expect(b).not.toBeNull();
    expect(b?.gov).toBe(s?.gov);
    expect(b?.adjustments).toEqual(s?.adjustments);
    expect(b?.rounding).toEqual(s?.rounding);
  });

  it("exact-override table matches the fs loader on a digitized date", () => {
    const b = browserCal.iraqExactTimes(POINTS[0].lat, POINTS[0].lon, "2026-06-19");
    const s = serverCal.iraqExactTimes(POINTS[0].lat, POINTS[0].lon, "2026-06-19");
    expect(b).not.toBeNull();
    for (const p of ORDER) expect(b?.[p]).toBe(s?.[p]);
  });
});
