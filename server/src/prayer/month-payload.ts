// Monthly prayer-times table (docs/V2_REDESIGN_SPEC.md Phase 5). ONE shared
// implementation for both sides: the web serves it as GET /api/prayer-times/month
// (routes.ts) and the native Capacitor app imports this file VERBATIM through
// the client's reusedEngineResolver (same mechanism as payload.ts) to compute
// the table offline. Keep it browser-safe: Intl only, no Node APIs; the Iraqi
// calibration import is redirected to its browser variant by the resolver.
//
// Rows are display-only (no timestamps): the table is static text, and "today"
// is highlighted by comparing `date` to the client's local day key.

import type {
  AsrMadhab,
  MethodName,
  PrayerTimesResult,
  TimeName,
} from "../prayer-engine/index.js";
import { computePrayerTimes } from "./compute.js";
import { baghdadInstant, iraqExactTimes } from "./iraq-calibration.js";
import { fmtTime, instantForCivilDate } from "./format.js";
import type { Lang } from "./events.js";

const PRAYER_ORDER: TimeName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

export interface MonthDayRow {
  /** Civil date YYYY-MM-DD in the target tz. */
  date: string;
  /** Umm al-Qura Hijri calendar parts for the same civil day. */
  hijriDay: number;
  hijriMonth: string;
  hijriYear: number;
  isFriday: boolean;
  /** Display strings in the target tz ("—" when absent, e.g. high latitude). */
  times: Record<TimeName, string>;
}

export interface MonthPayload {
  month: string;
  location: {
    city: string | null;
    country: string | null;
    tz: string;
    lat: number;
    lon: number;
    elevation: number | null;
  };
  method: {
    key: MethodName;
    label: string;
    asr: AsrMadhab;
    auto: boolean;
    baghdadCalibrated: boolean;
  };
  lang: Lang;
  days: MonthDayRow[];
}

export interface BuildMonthInput {
  lat: number;
  lon: number;
  elevation?: number;
  tz: string;
  lang: Lang;
  method: MethodName;
  methodLabel: string;
  asr: AsrMadhab;
  auto: boolean;
  baghdadCalibrated: boolean;
  city?: string;
  country?: string;
  /** Target month, YYYY-MM. */
  month: string;
}

/** Hijri (Umm al-Qura) day/month/year for an instant, in the target tz. */
function hijriParts(
  d: Date,
  tz: string,
  lang: Lang,
): { day: number; month: string; year: number } {
  const locale =
    lang === "ar" ? "ar-u-ca-islamic-umalqura-nu-latn" : "en-u-ca-islamic-umalqura";
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: Number(get("day")) || 0,
    month: get("month"),
    // "1448 AH" → 1448 (year part may carry an era suffix in some locales)
    year: Number(get("year").replace(/\D/g, "")) || 0,
  };
}

/** Friday check for a civil day, evaluated in the target tz. */
function isFridayInTz(d: Date, tz: string): boolean {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d) === "Fri"
  );
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * Overlay the official Iraqi Waqf poster numbers verbatim on digitized dates —
 * same rule as the daily payload (a literal 0-min match); every other
 * location/day keeps the calibrated formula times.
 */
function applyIraqExact(
  times: PrayerTimesResult,
  input: BuildMonthInput,
  isoDate: string,
): PrayerTimesResult {
  if (!input.baghdadCalibrated) return times;
  const exact = iraqExactTimes(input.lat, input.lon, isoDate);
  if (!exact) return times;
  const out: PrayerTimesResult = { ...times };
  for (const name of PRAYER_ORDER) {
    const hhmm = exact[name];
    if (hhmm) out[name] = baghdadInstant(isoDate, hhmm);
  }
  return out;
}

export function buildMonthPayload(input: BuildMonthInput): MonthPayload {
  const [year, month1] = input.month.split("-").map(Number);
  const total = daysInMonth(year, month1);

  const days: MonthDayRow[] = [];
  for (let d = 1; d <= total; d++) {
    const iso = `${input.month}-${String(d).padStart(2, "0")}`;
    const anchor = instantForCivilDate(iso, input.tz);

    const computed = computePrayerTimes({
      lat: input.lat,
      lon: input.lon,
      elevation: input.elevation,
      tz: input.tz,
      method: input.method,
      asr: input.asr,
      date: anchor,
    });
    const times = applyIraqExact(computed, input, iso);

    const hijri = hijriParts(anchor, input.tz, input.lang);
    const row: MonthDayRow = {
      date: iso,
      hijriDay: hijri.day,
      hijriMonth: hijri.month,
      hijriYear: hijri.year,
      isFriday: isFridayInTz(anchor, input.tz),
      times: Object.fromEntries(
        PRAYER_ORDER.map((name) => [name, fmtTime(times[name], input.tz, input.lang)]),
      ) as Record<TimeName, string>,
    };
    days.push(row);
  }

  return {
    month: input.month,
    location: {
      city: input.city ?? null,
      country: input.country ?? null,
      tz: input.tz,
      lat: input.lat,
      lon: input.lon,
      elevation: input.elevation ?? null,
    },
    method: {
      key: input.method,
      label: input.methodLabel,
      asr: input.asr,
      auto: input.auto,
      baghdadCalibrated: input.baghdadCalibrated,
    },
    lang: input.lang,
    days,
  };
}
