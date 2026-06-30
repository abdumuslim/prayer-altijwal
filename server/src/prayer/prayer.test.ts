import { describe, it, expect } from "vitest";
import { detectMethod, describeMethod } from "./method-detect.js";
import { fmtCountdown, dateKey, instantForCivilDate, minuteOfDay } from "./format.js";
import { hijriParts, nextIslamicEvent } from "./hijri.js";
import { buildPrayerTimesPayload } from "./payload.js";

const BAGHDAD = { lat: 33.321502, lon: 44.358335 };
const MOSUL = { lat: 36.335, lon: 43.118 };
const MECCA = { lat: 21.4225, lon: 39.8262 };
const LONDON = { lat: 51.5074, lon: -0.1278 };
const LONGYEARBYEN = { lat: 78.2232, lon: 15.6267 }; // polar day on the solstice

describe("detectMethod — country → method (Iraqi profile nationwide, ADR-002)", () => {
  it("Baghdad → calibrated Iraqi profile", () => {
    const m = detectMethod("IQ", BAGHDAD.lat, BAGHDAD.lon);
    expect(m.key).toBe("BaghdadYMA");
    expect(m.baghdadCalibrated).toBe(true);
  });

  it("Mosul (anywhere in Iraq) → the SAME calibrated Iraqi profile", () => {
    const m = detectMethod("IQ", MOSUL.lat, MOSUL.lon);
    expect(m.key).toBe("BaghdadYMA");
    expect(m.baghdadCalibrated).toBe(true);
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

  it("pre-Fajr ring: yesterdayIsha anchors a partial (depleting) interval before Fajr", () => {
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
      now: new Date("2026-02-18T01:00:00Z"), // 04:00 Baghdad — before today's Fajr (~05:20)
    });
    // Today's Fajr is the upcoming prayer (not tomorrow's).
    expect(p.nextPrayer!.name).toBe("fajr");
    expect(p.nextPrayer!.tomorrow).toBe(false);
    const fajr = p.prayers.find((x) => x.name === "fajr")!;
    // yesterdayIsha is present and precedes today's Fajr (the night before).
    expect(p.yesterdayIsha).not.toBeNull();
    expect(p.yesterdayIsha!).toBeLessThan(fajr.timestamp as number);
    // `now` falls strictly inside [yesterdayIsha → Fajr], so the depleting ring is
    // partial (0 < frac < 1) — the pre-Fajr "stuck full" bug would make this 0/1.
    const frac = (p.now - p.yesterdayIsha!) / ((fajr.timestamp as number) - p.yesterdayIsha!);
    expect(frac).toBeGreaterThan(0);
    expect(frac).toBeLessThan(1);
  });
});

describe("sunnah windows (Duha + Qiyam)", () => {
  function baghdad(now: string) {
    return buildPrayerTimesPayload({
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
      now: new Date(now),
    });
  }

  it("Duha is active mid-morning (start ≤ now < end)", () => {
    const p = baghdad("2026-02-18T06:00:00Z"); // 09:00 Baghdad — inside the forenoon window
    expect(p.duhaWindow).not.toBeNull();
    expect(p.duhaWindow!.start).toBeLessThanOrEqual(p.now);
    expect(p.now).toBeLessThan(p.duhaWindow!.end);
  });

  it("Duha rolls to tomorrow once the window has ended (start > now)", () => {
    const p = baghdad("2026-02-18T12:00:00Z"); // 15:00 Baghdad — well after Dhuhr−15
    expect(p.duhaWindow).not.toBeNull();
    expect(p.duhaWindow!.start).toBeGreaterThan(p.now);
  });

  it("Qiyam is active in the pre-Fajr last third, ending at today's Fajr", () => {
    const p = baghdad("2026-02-18T00:30:00Z"); // 03:30 Baghdad — last third of the night
    const fajr = p.prayers.find((x) => x.name === "fajr")!;
    expect(p.qiyamWindow).not.toBeNull();
    expect(p.qiyamWindow!.start).toBeLessThanOrEqual(p.now);
    expect(p.now).toBeLessThan(p.qiyamWindow!.end);
    // Window ends at (≈) today's Fajr instant.
    expect(Math.abs(p.qiyamWindow!.end - (fajr.timestamp as number))).toBeLessThan(2 * 60_000);
  });

  it("Qiyam rolls to tonight during the day (start > now, end ≈ tomorrow Fajr)", () => {
    const p = baghdad("2026-02-18T12:00:00Z"); // 15:00 Baghdad
    expect(p.qiyamWindow).not.toBeNull();
    expect(p.qiyamWindow!.start).toBeGreaterThan(p.now);
    expect(p.tomorrowFajr).not.toBeNull();
    expect(Math.abs(p.qiyamWindow!.end - p.tomorrowFajr!)).toBeLessThan(2 * 60_000);
  });

  it("polar day → both windows null (no sunrise/sunset; no Invalid Date leaks)", () => {
    const p = buildPrayerTimesPayload({
      lat: LONGYEARBYEN.lat,
      lon: LONGYEARBYEN.lon,
      tz: "Arctic/Longyearbyen",
      lang: "en",
      method: "MWL",
      methodLabel: "MWL",
      asr: "Standard",
      auto: true,
      baghdadCalibrated: false,
      country: "NO",
      date: "2026-06-21",
      now: new Date("2026-06-21T08:00:00Z"),
    });
    expect(p.duhaWindow).toBeNull();
    expect(p.qiyamWindow).toBeNull();
  });
});
