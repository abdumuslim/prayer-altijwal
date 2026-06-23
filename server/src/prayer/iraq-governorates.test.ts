// Accuracy guard for the nationwide Iraqi policy (DECISIONS.md ADR-002, reversed).
//
// The official ديوان الوقف السني poster for 4 Muharram 1448 / 19 June 2026
// publishes Baghdad PLUS a per-governorate table, all computed with one unified
// Iraqi method. We apply the calibrated `BaghdadYMA` profile to the WHOLE country
// (method-detect.ts) and assert that, evaluated at each governorate's own
// coordinates, it reproduces that poster.
//
// Each governorate is evaluated at its OWN elevation (the live path: compute.ts
// passes the dataset/GPS elevation for every method, BaghdadYMA included).
// Tolerances are physically motivated: dhuhr/asr are elevation-independent and
// fajr/isha are depression angles (weakly elevation-sensitive) → ≤2 min; sunrise
// and maghrib scale with horizon dip ∝ √elevation and still drift up to ~3 min
// even with real elevation, because the Waqf's almanac (Accurate Times) rounds
// and handles elevation slightly differently than our engine (e.g. Kirkuk) → ≤3.
import { describe, it, expect } from "vitest";
import { detectMethod } from "./method-detect.js";
import { computePrayerTimes } from "./compute.js";
import type { TimeName } from "../prayer-engine/index.js";

const TZ = "Asia/Baghdad";
const ORDER: TimeName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
// Per-prayer tolerance (minutes), in ORDER.
const TOL: Record<TimeName, number> = {
  fajr: 2,
  sunrise: 3,
  dhuhr: 2,
  asr: 2,
  maghrib: 3,
  isha: 2,
};

function baghdadMinute(d: Date): number {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return Number(map.hour) * 60 + Number(map.minute);
}

function tableMinute(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// 2026-06-19, any instant inside the Baghdad civil day; engine re-anchors.
const DATE = new Date(Date.UTC(2026, 5, 19, 9, 0, 0));

interface Gov {
  name: string;
  lat: number;
  lon: number;
  /** Metres above sea level (GeoNames `ele`), passed as the live app does. */
  ele: number;
  /** Official poster times (24h): [fajr, sunrise, dhuhr, asr, maghrib, isha]. */
  poster: [string, string, string, string, string, string];
}

// Coordinates are the governorate capitals; poster values transcribed from the
// official 19-June-2026 Waqf table.
const BAGHDAD: Gov = {
  name: "Baghdad",
  lat: 33.3152,
  lon: 44.3661,
  ele: 41,
  poster: ["03:10", "04:52", "12:09", "15:51", "19:18", "20:51"],
};

const GOVERNORATES: Gov[] = [
  { name: "Basra", lat: 30.5085, lon: 47.7804, ele: 4, poster: ["03:09", "04:46", "11:55", "15:30", "18:57", "20:25"] },
  { name: "Hilla", lat: 32.4637, lon: 44.4197, ele: 33, poster: ["03:14", "04:54", "12:09", "15:48", "19:15", "20:47"] },
  { name: "Diwaniyah", lat: 31.9928, lon: 44.9247, ele: 25, poster: ["03:14", "04:54", "12:07", "15:45", "19:12", "20:43"] },
  { name: "Ramadi", lat: 33.4258, lon: 43.3089, ele: 53, poster: ["03:14", "04:56", "12:14", "15:55", "19:23", "20:56"] },
  { name: "Samawah", lat: 31.3093, lon: 45.281, ele: 15, poster: ["03:17", "04:54", "12:05", "15:42", "19:08", "20:39"] },
  { name: "Amarah", lat: 31.8356, lon: 47.1446, ele: 10, poster: ["03:06", "04:45", "11:58", "15:36", "19:02", "20:33"] },
  { name: "Fallujah", lat: 33.35, lon: 43.7858, ele: 45, poster: ["03:12", "04:54", "12:11", "15:53", "19:20", "20:54"] },
  { name: "Kut", lat: 32.5126, lon: 45.8181, ele: 22, poster: ["03:08", "04:49", "12:03", "15:43", "19:10", "20:42"] },
  { name: "Mosul", lat: 36.345, lon: 43.145, ele: 228, poster: ["02:58", "04:47", "12:14", "16:03", "19:33", "21:11"] },
  { name: "Nasiriyah", lat: 31.054, lon: 46.257, ele: 7, poster: ["03:12", "04:50", "12:01", "15:38", "19:04", "20:34"] },
  { name: "Baqubah", lat: 33.7506, lon: 44.6447, ele: 48, poster: ["03:07", "04:50", "12:08", "15:50", "19:18", "20:52"] },
  { name: "Tikrit", lat: 34.61, lon: 43.68, ele: 112, poster: ["03:06", "04:51", "12:12", "15:57", "19:25", "21:00"] },
  { name: "Samarra", lat: 34.1983, lon: 43.8742, ele: 80, poster: ["03:08", "04:52", "12:11", "15:55", "19:23", "20:57"] },
  { name: "Kirkuk", lat: 35.4681, lon: 44.3922, ele: 346, poster: ["02:58", "04:46", "12:09", "15:56", "19:26", "21:02"] },
];

describe("Iraqi method is applied country-wide (ADR-002 reversed)", () => {
  it.each([BAGHDAD, ...GOVERNORATES])("$name auto-detects the Iraqi profile", (gov) => {
    expect(detectMethod("IQ", gov.lat, gov.lon).key).toBe("BaghdadYMA");
  });
});

describe("Governorate times vs the official Waqf poster (2026-06-19)", () => {
  it("Baghdad matches the poster within ±1 min", () => {
    const t = computePrayerTimes({ lat: BAGHDAD.lat, lon: BAGHDAD.lon, elevation: BAGHDAD.ele, tz: TZ, method: "BaghdadYMA", date: DATE });
    ORDER.forEach((name, i) => {
      const diff = Math.abs(baghdadMinute(t[name]) - tableMinute(BAGHDAD.poster[i]));
      expect(diff, `Baghdad ${name}`).toBeLessThanOrEqual(1);
    });
  });

  it.each(GOVERNORATES)("$name matches the poster within tolerance", (gov) => {
    const t = computePrayerTimes({ lat: gov.lat, lon: gov.lon, elevation: gov.ele, tz: TZ, method: "BaghdadYMA", date: DATE });
    ORDER.forEach((name, i) => {
      const diff = Math.abs(baghdadMinute(t[name]) - tableMinute(gov.poster[i]));
      expect(diff, `${gov.name} ${name}`).toBeLessThanOrEqual(TOL[name]);
    });
  });
});
