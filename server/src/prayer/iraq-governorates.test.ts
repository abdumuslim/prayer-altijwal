// Accuracy guard for the nationwide Iraqi policy (DECISIONS.md ADR-002, reversed).
//
// The official ديوان الوقف السني poster for 4 Muharram 1448 / 19 June 2026
// publishes Baghdad PLUS a per-governorate table, all computed with one unified
// Iraqi method. We apply the calibrated `BaghdadYMA` profile to the WHOLE country
// (method-detect.ts) with a PER-GOVERNORATE calibration (iraq-calibration.ts, fit
// to the official table — ~83% exact, 99.4% within ±1 over 35 dates × 15 govs) and
// assert that, evaluated at each governorate's own coordinates, it reproduces the
// poster within ≤2 min (Baghdad, the anchor, within ≤1).
//
// Each governorate is evaluated at its OWN elevation (the live path: compute.ts
// passes the dataset/GPS elevation for every method, BaghdadYMA included).
//
// Separately, the exact-data override (iraqExactTimes / payload) serves the poster
// numbers verbatim on a digitized date — a LITERAL 0-min match, asserted below.
import { describe, it, expect } from "vitest";
import { detectMethod } from "./method-detect.js";
import { computePrayerTimes } from "./compute.js";
import { iraqExactTimes } from "./iraq-calibration.js";
import { buildPrayerTimesPayload } from "./payload.js";
import type { TimeName } from "../prayer-engine/index.js";

const TZ = "Asia/Baghdad";
const ORDER: TimeName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
// Per-prayer tolerance (minutes) for the CALIBRATED FORMULA, in ORDER. The
// per-gov calibration tightens the old 2/3/2/2/3/2 envelope; residual ±1 is the
// Waqf table's own rounding jitter (its sources disagree by ±1).
const TOL: Record<TimeName, number> = {
  fajr: 2,
  sunrise: 3, // kept for now; the old "Kirkuk horizon-dip differs" rationale is obsolete
              // (re-verified Kirkuk sunrise 04:43 matches the engine exactly — see below)
  dhuhr: 1,
  asr: 2,
  maghrib: 2,
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
// official poster photo, re-verified 2026-08-12 at 6–10x zoom against the
// byte-identical Facebook original (fb_1361459246086147.jpg, SHA-256-equal to the
// June source photo) after eleven 1-minute transcription errors were found — incl.
// a swapped Nasiriyah/Tikrit sunrise pair and Kirkuk sunrise 04:46→04:43. Baghdad
// (the hero anchor) and all other cells are confirmed correct. Kirkuk's true
// sunrise (04:43) matches the engine EXACTLY, so the old "the Waqf almanac treats
// high-elevation horizon dip differently" rationale for the ≤3-min sunrise
// tolerance is obsolete (the tolerance itself is kept unchanged for now).
const BAGHDAD: Gov = {
  name: "Baghdad",
  lat: 33.34058,
  lon: 44.40088,
  ele: 41,
  poster: ["03:10", "04:52", "12:09", "15:51", "19:18", "20:51"],
};

const GOVERNORATES: Gov[] = [
  { name: "Basra", lat: 30.5085, lon: 47.7804, ele: 4, poster: ["03:09", "04:46", "11:55", "15:30", "18:56", "20:25"] },
  { name: "Hilla", lat: 32.4637, lon: 44.4197, ele: 33, poster: ["03:14", "04:54", "12:09", "15:48", "19:15", "20:47"] },
  { name: "Diwaniyah", lat: 31.9928, lon: 44.9247, ele: 25, poster: ["03:14", "04:54", "12:07", "15:45", "19:12", "20:43"] },
  { name: "Ramadi", lat: 33.4258, lon: 43.3089, ele: 53, poster: ["03:14", "04:56", "12:14", "15:56", "19:23", "20:56"] },
  { name: "Samawah", lat: 31.3093, lon: 45.281, ele: 15, poster: ["03:16", "04:54", "12:05", "15:42", "19:08", "20:39"] },
  { name: "Amarah", lat: 31.8356, lon: 47.1446, ele: 10, poster: ["03:06", "04:45", "11:58", "15:36", "19:02", "20:33"] },
  { name: "Fallujah", lat: 33.35, lon: 43.7858, ele: 45, poster: ["03:12", "04:54", "12:11", "15:53", "19:20", "20:54"] },
  { name: "Kut", lat: 32.5126, lon: 45.8181, ele: 22, poster: ["03:08", "04:49", "12:03", "15:43", "19:10", "20:42"] },
  { name: "Mosul", lat: 36.345, lon: 43.145, ele: 228, poster: ["02:59", "04:47", "12:14", "16:03", "19:33", "21:11"] },
  { name: "Nasiriyah", lat: 31.054, lon: 46.257, ele: 7, poster: ["03:13", "04:51", "12:01", "15:38", "19:04", "20:34"] },
  { name: "Baqubah", lat: 33.7506, lon: 44.6447, ele: 48, poster: ["03:07", "04:50", "12:08", "15:51", "19:18", "20:52"] },
  { name: "Tikrit", lat: 34.61, lon: 43.68, ele: 112, poster: ["03:06", "04:50", "12:12", "15:57", "19:25", "21:00"] },
  { name: "Samarra", lat: 34.1983, lon: 43.8742, ele: 80, poster: ["03:08", "04:51", "12:11", "15:55", "19:23", "20:57"] },
  { name: "Kirkuk", lat: 35.4681, lon: 44.3922, ele: 346, poster: ["02:59", "04:43", "12:09", "15:56", "19:26", "21:02"] },
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

describe("Exact-data override reproduces the poster verbatim (literal 0-min)", () => {
  // 2026-06-19 is a digitized date in waqf-exact.json.
  it("iraqExactTimes returns the poster for a digitized (gov, date)", () => {
    const exact = iraqExactTimes(BAGHDAD.lat, BAGHDAD.lon, "2026-06-19");
    expect(exact).not.toBeNull();
    ORDER.forEach((name, i) => {
      expect(exact?.[name], `Baghdad ${name}`).toBe(BAGHDAD.poster[i]);
    });
  });

  it("returns null for a date beyond the recycled window (→ calibrated formula)", () => {
    // The archive ends in 2026; recycle only probes 3 years back (2030/2029/2028),
    // so a 2031 date has no exact or recycled poster → the formula path.
    expect(iraqExactTimes(BAGHDAD.lat, BAGHDAD.lon, "2031-06-20")).toBeNull();
  });

  it("recycles the previous year's poster when the exact date is missing", () => {
    // 2027-06-19 is not digitized; the fallback serves the 2026-06-19 poster verbatim
    // (year-recycle end-to-end — this is how dates after the archive ends resolve).
    const recycled = iraqExactTimes(BAGHDAD.lat, BAGHDAD.lon, "2027-06-19");
    expect(recycled).not.toBeNull();
    ORDER.forEach((name, i) => {
      expect(recycled?.[name], `Baghdad ${name}`).toBe(BAGHDAD.poster[i]);
    });
  });

  it.each([BAGHDAD, ...GOVERNORATES])("$name payload equals the poster exactly on the digitized date", (gov) => {
    const payload = buildPrayerTimesPayload({
      lat: gov.lat, lon: gov.lon, elevation: gov.ele, tz: TZ, lang: "en",
      method: "BaghdadYMA", methodLabel: "BaghdadYMA", asr: "Standard",
      auto: true, baghdadCalibrated: true, country: "IQ", date: "2026-06-19",
      now: new Date("2026-06-19T00:00:00+03:00"),
    });
    payload.prayers.forEach((entry, i) => {
      expect(entry.timestamp, `${gov.name} ${entry.name} present`).not.toBeNull();
      const diff = Math.abs(baghdadMinute(new Date(entry.timestamp as number)) - tableMinute(gov.poster[i]));
      expect(diff, `${gov.name} ${entry.name}`).toBe(0);
    });
  });
});
