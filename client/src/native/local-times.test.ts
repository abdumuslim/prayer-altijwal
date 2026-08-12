// Parity guard for the offline (native) prayer-time compute path.
//
// Proves the reused engine + Iraqi Waqf calibration run correctly in the browser
// build (astronomy-engine loaded via the node:module shim; calibration + exact
// tables loaded via ESM JSON imports) by reproducing the official ديوان الوقف
// السني poster for a DIGITIZED date VERBATIM — a literal 0-min match, exactly as
// the server test (server/src/prayer/iraq-governorates.test.ts) asserts. If the
// shims or aliases were wrong, the engine wouldn't run and this would fail.

import { describe, it, expect } from "vitest";
import { computeLocalPrayerTimes } from "./local-times";
import type { TimeName } from "../../../server/src/prayer-engine/index.js";
import type { StoredLocation } from "@/lib/storage";

const TZ = "Asia/Baghdad";
const ORDER: TimeName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

function baghdadMinute(ts: number): number {
  const map: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ts))) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return Number(map.hour) * 60 + Number(map.minute);
}

function tableMinute(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

interface Gov {
  name: string;
  lat: number;
  lon: number;
  ele: number;
  /** Official poster (24h): [fajr, sunrise, dhuhr, asr, maghrib, isha]. */
  poster: [string, string, string, string, string, string];
}

// A spread of the digitized 2026-06-19 poster: the anchor + low/high elevation +
// north/south latitude, from the official Waqf table (re-verified 2026-08-12 at
// 6–10x zoom — Basra maghrib, Mosul fajr, Kirkuk fajr/sunrise were transcription
// errors; matches iraq-governorates.test.ts and the adjudicated waqf-exact.json).
const GOVS: Gov[] = [
  { name: "Baghdad", lat: 33.34058, lon: 44.40088, ele: 41, poster: ["03:10", "04:52", "12:09", "15:51", "19:18", "20:51"] },
  { name: "Basra", lat: 30.5085, lon: 47.7804, ele: 4, poster: ["03:09", "04:46", "11:55", "15:30", "18:56", "20:25"] },
  { name: "Mosul", lat: 36.345, lon: 43.145, ele: 228, poster: ["02:59", "04:47", "12:14", "16:03", "19:33", "21:11"] },
  { name: "Kirkuk", lat: 35.4681, lon: 44.3922, ele: 346, poster: ["02:59", "04:43", "12:09", "15:56", "19:26", "21:02"] },
];

function loc(gov: Gov): StoredLocation {
  return {
    city: gov.name,
    cityAr: null,
    country: "IQ",
    tz: TZ,
    lat: gov.lat,
    lon: gov.lon,
    elevation: gov.ele,
  };
}

describe("offline compute reproduces the server payload (Iraqi Waqf, digitized date)", () => {
  it.each(GOVS)("$name payload equals the poster exactly (literal 0-min)", (gov) => {
    const payload = computeLocalPrayerTimes({
      location: loc(gov),
      lang: "en",
      methodAuto: true,
      date: "2026-06-19",
      now: new Date("2026-06-19T00:00:00+03:00"),
    });
    // Auto-detects the calibrated Iraqi profile from country=IQ.
    expect(payload.method.key).toBe("BaghdadYMA");
    expect(payload.method.baghdadCalibrated).toBe(true);
    ORDER.forEach((name, i) => {
      const entry = payload.prayers.find((p) => p.name === name);
      expect(entry?.timestamp, `${gov.name} ${name} present`).not.toBeNull();
      const diff = Math.abs(baghdadMinute(entry!.timestamp as number) - tableMinute(gov.poster[i]));
      expect(diff, `${gov.name} ${name}`).toBe(0);
    });
  });

  it("Baghdad Duha/Qiyam windows are present and well-formed", () => {
    const payload = computeLocalPrayerTimes({
      location: loc(GOVS[0]),
      lang: "en",
      methodAuto: true,
      date: "2026-06-19",
      now: new Date("2026-06-19T00:00:00+03:00"),
    });
    expect(payload.duhaWindow).not.toBeNull();
    expect(payload.qiyamWindow).not.toBeNull();
    expect(payload.duhaWindow!.end).toBeGreaterThan(payload.duhaWindow!.start);
    expect(payload.tomorrowFajr).not.toBeNull();
  });
});
