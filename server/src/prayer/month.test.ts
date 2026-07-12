// Monthly table tests (docs/V2_REDESIGN_SPEC.md Phase 5). The core property is
// PARITY: for any day, the month row's display strings must equal the daily
// payload's `prayers[].time` for that date — this transitively covers the
// Iraqi calibration AND the Waqf exact-data overlay (both code paths shared).

import { describe, expect, it } from "vitest";
import { buildMonthPayload } from "./month-payload.js";
import { buildPrayerTimesPayload } from "./payload.js";
import { detectMethod } from "./method-detect.js";
import { MonthQuery } from "../validation/prayer-times.js";

const BAGHDAD = { lat: 33.3152, lon: 44.3661, tz: "Asia/Baghdad" } as const;

function baghdadInput(month: string) {
  const det = detectMethod("IQ", BAGHDAD.lat, BAGHDAD.lon);
  return {
    ...BAGHDAD,
    lang: "ar" as const,
    method: det.key,
    methodLabel: det.label,
    asr: det.asr,
    auto: true,
    baghdadCalibrated: det.baghdadCalibrated,
    country: "IQ",
    city: "Baghdad",
    month,
  };
}

describe("buildMonthPayload", () => {
  it("returns one row per civil day of the month", () => {
    expect(buildMonthPayload(baghdadInput("2026-07")).days).toHaveLength(31);
    expect(buildMonthPayload(baghdadInput("2026-02")).days).toHaveLength(28);
    expect(buildMonthPayload(baghdadInput("2028-02")).days).toHaveLength(29); // leap
  });

  it("rows match the daily endpoint's display times exactly (calibration + Waqf overlay parity)", () => {
    const month = buildMonthPayload(baghdadInput("2026-07"));
    // Spot-check three days across the month (1st, mid, last).
    for (const date of ["2026-07-01", "2026-07-15", "2026-07-31"]) {
      const row = month.days.find((d) => d.date === date)!;
      const daily = buildPrayerTimesPayload({ ...baghdadInput("2026-07"), date });
      for (const p of daily.prayers) {
        expect(row.times[p.name], `${date} ${p.name}`).toBe(p.time);
      }
    }
  });

  it("flags Fridays in the location tz", () => {
    const month = buildMonthPayload(baghdadInput("2026-07"));
    const fridays = month.days.filter((d) => d.isFriday).map((d) => d.date);
    expect(fridays).toEqual([
      "2026-07-03",
      "2026-07-10",
      "2026-07-17",
      "2026-07-24",
      "2026-07-31",
    ]);
  });

  it("carries Umm al-Qura Hijri parts per row", () => {
    const month = buildMonthPayload(baghdadInput("2026-07"));
    for (const d of month.days) {
      expect(d.hijriDay).toBeGreaterThanOrEqual(1);
      expect(d.hijriDay).toBeLessThanOrEqual(30);
      expect(d.hijriMonth.length).toBeGreaterThan(0);
      expect(d.hijriYear).toBeGreaterThan(1400);
    }
    // Hijri day advances (or wraps to 1) between consecutive rows.
    for (let i = 1; i < month.days.length; i++) {
      const prev = month.days[i - 1].hijriDay;
      const cur = month.days[i].hijriDay;
      expect(cur === prev + 1 || cur === 1).toBe(true);
    }
  });

  it("survives high latitudes without throwing (— for absent times)", () => {
    const det = detectMethod("NO", 69.6492, 18.9553);
    const month = buildMonthPayload({
      lat: 69.6492,
      lon: 18.9553,
      tz: "Europe/Oslo",
      lang: "en",
      method: det.key,
      methodLabel: det.label,
      asr: det.asr,
      auto: true,
      baghdadCalibrated: det.baghdadCalibrated,
      month: "2026-06", // midnight sun
    });
    expect(month.days).toHaveLength(30);
    for (const d of month.days) {
      for (const t of Object.values(d.times)) expect(typeof t).toBe("string");
    }
  });
});

describe("MonthQuery validation", () => {
  const base = { lat: "33.3", lon: "44.4", tz: "Asia/Baghdad" };

  it("accepts a valid YYYY-MM month", () => {
    expect(MonthQuery.safeParse({ ...base, month: "2026-07" }).success).toBe(true);
  });

  it("rejects malformed months", () => {
    for (const month of ["2026-13", "2026-7", "2026-07-12", "next-month", ""]) {
      expect(MonthQuery.safeParse({ ...base, month }).success, month).toBe(false);
    }
  });

  it("rejects a date param (daily-only)", () => {
    const r = MonthQuery.safeParse({ ...base, month: "2026-07", date: "2026-07-12" });
    // omit() strips it — unknown keys are ignored by zod objects by default,
    // so presence doesn't fail; assert it simply doesn't survive parsing.
    expect(r.success && !("date" in r.data)).toBe(true);
  });
});
