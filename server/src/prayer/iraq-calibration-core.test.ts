// Unit tests for the pure, browser-safe Iraqi-calibration core — specifically
// the year-recycle fallback in iraqExactTimesFrom (the Waqf reposts previous-year
// cards, so a missing exact date recycles the same Gregorian date up to 3 years
// back). The full-corpus fit + poster-verbatim behavior is guarded separately in
// iraq-governorates.test.ts.
import { describe, it, expect } from "vitest";
import {
  iraqExactTimesFrom,
  EXACT_OVERRIDE_KM,
  type GovCalibration,
  type ExactTable,
  type NoRecycleTable,
} from "./iraq-calibration-core.js";

// One synthetic calibrated governorate; the query sits on its capital (km ≈ 0).
const CITY = { lat: 33, lon: 44 };
const GOVS: GovCalibration[] = [
  { name: "Testville", lat: CITY.lat, lon: CITY.lon, offsets: {}, rounding: {} },
];

// A full 6-prayer poster whose fajr encodes the source year so tests can assert
// which year's card was served.
function poster(fajr: string): Record<string, string> {
  return { fajr, sunrise: "06:00", dhuhr: "12:00", asr: "15:00", maghrib: "18:00", isha: "19:26" };
}

function table(entries: Record<string, Record<string, string>>): ExactTable {
  return { Testville: entries };
}

describe("iraqExactTimesFrom — year-recycle fallback", () => {
  it("prefers the exact date over any recycled year", () => {
    const exact = table({ "2026-05-10": poster("05:26"), "2025-05-10": poster("05:25") });
    const out = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-05-10");
    expect(out?.fajr).toBe("05:26");
  });

  it("recycles year−1 when the exact date is missing", () => {
    const exact = table({ "2025-05-10": poster("05:25") });
    const out = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-05-10");
    expect(out?.fajr).toBe("05:25");
  });

  it("recycles year−2", () => {
    const exact = table({ "2024-07-01": poster("03:24") });
    const out = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-07-01");
    expect(out?.fajr).toBe("03:24");
  });

  it("recycles year−3 (the oldest allowed)", () => {
    const exact = table({ "2023-08-20": poster("04:23") });
    const out = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-08-20");
    expect(out?.fajr).toBe("04:23");
  });

  it("returns null when the only match is more than 3 years back", () => {
    const exact = table({ "2022-08-20": poster("04:22") });
    expect(iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-08-20")).toBeNull();
  });

  it("falls back Feb-29 → Feb-28 of an earlier year", () => {
    // 2028 is a leap year; 2027 is not, so the only recycle candidate is 2027-02-28.
    const exact = table({ "2027-02-28": poster("05:27") });
    const out = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2028-02-29");
    expect(out?.fajr).toBe("05:27");
  });

  it("prefers an exact leap-day entry over the Feb-28 recycle fallback", () => {
    // The target's own leap day is present → exact hit wins (never recycled).
    const exact = table({ "2028-02-29": poster("05:29"), "2027-02-28": poster("05:28") });
    const out = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2028-02-29");
    expect(out?.fajr).toBe("05:29");
  });
});

describe("iraqExactTimesFrom — noRecycle guard", () => {
  it("omits a noRecycle prayer from a recycled result but keeps it on the exact date", () => {
    const exact = table({ "2025-04-16": poster("04:03") }); // only the source year present
    const nr: NoRecycleTable = { Testville: { "2025-04-16": ["fajr"] } };
    // recycled onto 2026-04-16 → the flagged fajr is dropped, other prayers stay
    const recycled = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-04-16", nr);
    expect(recycled?.fajr).toBeUndefined();
    expect(recycled?.dhuhr).toBe("12:00");
    // exact-date query → fajr served verbatim (an exact hit is never filtered)
    expect(iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2025-04-16", nr)?.fajr).toBe("04:03");
  });

  it("keeps the unflagged prayers of a recycled cell", () => {
    const exact = table({ "2025-06-01": poster("03:20") });
    const nr: NoRecycleTable = { Testville: { "2025-06-01": ["fajr", "isha"] } };
    const recycled = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-06-01", nr);
    expect(recycled?.fajr).toBeUndefined();
    expect(recycled?.isha).toBeUndefined();
    expect(recycled?.sunrise).toBe("06:00");
    expect(recycled?.maghrib).toBe("18:00");
  });

  it("falls through to an earlier year when every prayer of a candidate is flagged", () => {
    const exact = table({
      "2025-08-20": poster("04:25"), // year−1: fully flagged
      "2024-08-20": poster("04:24"), // year−2: clean
    });
    const nr: NoRecycleTable = {
      Testville: { "2025-08-20": ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] },
    };
    const recycled = iraqExactTimesFrom(GOVS, exact, CITY.lat, CITY.lon, "2026-08-20", nr);
    expect(recycled?.fajr).toBe("04:24");
  });
});

describe("iraqExactTimesFrom — distance gate", () => {
  it("returns null beyond the exact-override radius (existing behavior)", () => {
    const exact = table({ "2026-05-10": poster("05:26") });
    // ~111 km north of the capital — well past EXACT_OVERRIDE_KM.
    const far = iraqExactTimesFrom(GOVS, exact, CITY.lat + 1, CITY.lon, "2026-05-10");
    expect(far).toBeNull();
    expect(EXACT_OVERRIDE_KM).toBe(45);
  });
});
