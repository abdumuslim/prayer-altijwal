import { describe, it, expect } from "vitest";
import { detectMethod, describeMethod } from "./method-detect.js";
import { fmtCountdown, dateKey, instantForCivilDate, minuteOfDay } from "./format.js";
import { hijriParts, nextIslamicEvent } from "./hijri.js";
import { buildPrayerTimesPayload } from "./payload.js";

const BAGHDAD = { lat: 33.321502, lon: 44.358335 };
const MOSUL = { lat: 36.335, lon: 43.118 };
const MECCA = { lat: 21.4225, lon: 39.8262 };
const LONDON = { lat: 51.5074, lon: -0.1278 };

describe("detectMethod — country → method + Baghdad-only nuance", () => {
  it("Baghdad → full BaghdadYMA (calibrated)", () => {
    const m = detectMethod("IQ", BAGHDAD.lat, BAGHDAD.lon);
    expect(m.key).toBe("BaghdadYMA");
    expect(m.baghdadCalibrated).toBe(true);
  });

  it("Mosul (IQ, outside Baghdad radius) → MWL angles, NOT calibrated", () => {
    const m = detectMethod("IQ", MOSUL.lat, MOSUL.lon);
    expect(m.key).toBe("MWL");
    expect(m.baghdadCalibrated).toBe(false);
  });

  it("country table: SA→UmmAlQura, US→ISNA, EG→Egyptian, TR→Diyanet", () => {
    expect(detectMethod("SA", MECCA.lat, MECCA.lon).key).toBe("UmmAlQura");
    expect(detectMethod("US", 40, -74).key).toBe("ISNA");
    expect(detectMethod("EG", 30, 31).key).toBe("Egyptian");
    expect(detectMethod("TR", 41, 29).key).toBe("Diyanet");
  });

  it("unknown / missing country → MWL", () => {
    expect(detectMethod(undefined, 0, 0).key).toBe("MWL");
    expect(detectMethod("ZZ", 0, 0).key).toBe("MWL");
  });

  it("describeMethod returns label + default asr", () => {
    expect(describeMethod("Karachi").label).toContain("Karachi");
    expect(describeMethod("BaghdadYMA").asr).toBe("Standard");
  });
});

describe("format helpers", () => {
  it("fmtCountdown formats h/m/s and returns null when passed", () => {
    expect(fmtCountdown(2 * 3600_000 + 5 * 60_000)).toBe("2h 5m");
    expect(fmtCountdown(45 * 60_000 + 12_000)).toBe("45m 12s");
    expect(fmtCountdown(30_000)).toBe("30s");
    expect(fmtCountdown(0)).toBeNull();
    expect(fmtCountdown(-5)).toBeNull();
  });

  it("dateKey + instantForCivilDate round-trip across an extreme tz", () => {
    const d = instantForCivilDate("2026-06-19", "Pacific/Kiritimati"); // UTC+14
    expect(dateKey(d, "Pacific/Kiritimati")).toBe("2026-06-19");
    const d2 = instantForCivilDate("2026-06-19", "Etc/GMT+12"); // UTC-12
    expect(dateKey(d2, "Etc/GMT+12")).toBe("2026-06-19");
  });

  it("minuteOfDay extracts local minute-of-day", () => {
    // 2026-06-19T09:30:00Z in Asia/Baghdad (UTC+3) → 12:30 → 750
    expect(minuteOfDay(new Date("2026-06-19T09:30:00Z"), "Asia/Baghdad")).toBe(12 * 60 + 30);
  });
});

describe("hijri", () => {
  it("hijriParts returns plausible month/day", () => {
    const p = hijriParts(new Date("2026-06-19T12:00:00Z"), "Asia/Baghdad");
    expect(p.month).toBeGreaterThanOrEqual(1);
    expect(p.month).toBeLessThanOrEqual(12);
    expect(p.day).toBeGreaterThanOrEqual(1);
    expect(p.day).toBeLessThanOrEqual(30);
  });

  it("nextIslamicEvent finds an upcoming event within a year", () => {
    const ev = nextIslamicEvent(new Date("2026-06-19T12:00:00Z"), "Asia/Baghdad", "en");
    expect(ev).not.toBeNull();
    expect(ev!.daysLeft).toBeGreaterThanOrEqual(0);
    expect(ev!.daysLeft).toBeLessThanOrEqual(360);
    expect(typeof ev!.name).toBe("string");
  });
});

describe("buildPrayerTimesPayload", () => {
  it("Baghdad matches the printed calendar (2026-02-18 Fajr 5:20 AM)", () => {
    const p = buildPrayerTimesPayload({
      lat: BAGHDAD.lat,
      lon: BAGHDAD.lon,
      tz: "Asia/Baghdad",
      lang: "en",
      method: "BaghdadYMA",
      methodLabel: "Baghdad",
      asr: "Standard",
      auto: true,
      baghdadCalibrated: true,
      country: "IQ",
      city: "Baghdad",
      date: "2026-02-18",
      now: new Date("2026-02-18T00:00:00Z"),
    });
    expect(p.prayers).toHaveLength(6);
    const fajr = p.prayers.find((x) => x.name === "fajr")!;
    expect(fajr.time).toBe("5:20 AM");
    const maghrib = p.prayers.find((x) => x.name === "maghrib")!;
    expect(maghrib.time).toBe("5:53 PM");
    // Timestamps strictly increasing through the day.
    const ts = p.prayers.map((x) => x.timestamp as number);
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1]);
    expect(p.location.tz).toBe("Asia/Baghdad");
    expect(p.hijriDate.length).toBeGreaterThan(0);
    expect(p.nextPrayer).not.toBeNull();
    expect(p.tomorrowFajr).not.toBeNull();
  });

  it("tz-correctness: Mecca formatted in Asia/Riyadh (target tz, not device tz)", () => {
    const p = buildPrayerTimesPayload({
      lat: MECCA.lat,
      lon: MECCA.lon,
      tz: "Asia/Riyadh",
      lang: "en",
      method: "UmmAlQura",
      methodLabel: "Umm al-Qura",
      asr: "Standard",
      auto: true,
      baghdadCalibrated: false,
      country: "SA",
      city: "Mecca",
      date: "2026-06-19",
      now: new Date("2026-06-19T00:00:00Z"),
    });
    expect(p.location.tz).toBe("Asia/Riyadh");
    // Dhuhr ~ solar noon in Riyadh tz → between 11:30 and 12:45 local.
    const dhuhr = p.prayers.find((x) => x.name === "dhuhr")!;
    expect(dhuhr.time).toMatch(/^12:\d{2} PM$/);
  });

  it("high-latitude safety: London summer Fajr is a real time (AngleBased, no NaN)", () => {
    const p = buildPrayerTimesPayload({
      lat: LONDON.lat,
      lon: LONDON.lon,
      tz: "Europe/London",
      lang: "en",
      method: "MWL",
      methodLabel: "MWL",
      asr: "Standard",
      auto: true,
      baghdadCalibrated: false,
      country: "GB",
      city: "London",
      date: "2026-06-21",
      now: new Date("2026-06-21T00:00:00Z"),
    });
    const fajr = p.prayers.find((x) => x.name === "fajr")!;
    expect(fajr.timestamp).not.toBeNull();
    expect(fajr.time).not.toBe("—");
    const isha = p.prayers.find((x) => x.name === "isha")!;
    expect(isha.timestamp).not.toBeNull();
  });

  it("rollover: when all of today has passed, nextPrayer is tomorrow's Fajr", () => {
    const p = buildPrayerTimesPayload({
      lat: BAGHDAD.lat,
      lon: BAGHDAD.lon,
      tz: "Asia/Baghdad",
      lang: "en",
      method: "BaghdadYMA",
      methodLabel: "Baghdad",
      asr: "Standard",
      auto: true,
      baghdadCalibrated: true,
      country: "IQ",
      date: "2026-02-18",
      now: new Date("2026-02-18T23:00:00Z"), // 02:00 next day Baghdad — after Isha
    });
    expect(p.nextPrayer).not.toBeNull();
    expect(p.nextPrayer!.tomorrow).toBe(true);
    expect(p.nextPrayer!.name).toBe("fajr");
  });
});
