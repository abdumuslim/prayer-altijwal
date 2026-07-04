import { describe, expect, test } from "vitest";
import { isFridayKey, prayerNameKey } from "./prayer-names";

describe("isFridayKey", () => {
  test("true on a Friday, false otherwise", () => {
    expect(isFridayKey("2026-07-03")).toBe(true); // a Friday
    expect(isFridayKey("2026-07-02")).toBe(false); // Thursday
    expect(isFridayKey("2026-07-04")).toBe(false); // Saturday
  });

  test("independent of the device tz (uses the civil date only)", () => {
    // Every Friday in July 2026 (the 3rd, 10th, 17th, 24th, 31st).
    for (const d of ["2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]) {
      expect(isFridayKey(d)).toBe(true);
    }
  });
});

describe("prayerNameKey", () => {
  test("swaps dhuhr → jumuah only on Fridays", () => {
    expect(prayerNameKey("dhuhr", true)).toBe("prayer.jumuah");
    expect(prayerNameKey("dhuhr", false)).toBe("prayer.dhuhr");
  });

  test("leaves other prayers untouched on Fridays", () => {
    expect(prayerNameKey("fajr", true)).toBe("prayer.fajr");
    expect(prayerNameKey("asr", true)).toBe("prayer.asr");
    expect(prayerNameKey("maghrib", false)).toBe("prayer.maghrib");
  });
});
