import type { AsrMadhab, MethodName, PrayerTimesResult, TimeName } from "../prayer-engine/index.js";
import { computePrayerTimes } from "./compute.js";
import { dateKey, fmtCountdown, fmtTime, instantForCivilDate, isValidDate } from "./format.js";
import { hijriDate, nextIslamicEvent } from "./hijri.js";
import type { Lang } from "./events.js";

const DAY_MS = 86_400_000;

const PRAYER_ORDER: TimeName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
const LABELS: Record<TimeName, string> = {
  fajr: "Fajr",
  sunrise: "Sunrise",
  dhuhr: "Dhuhr",
  asr: "Asr",
  maghrib: "Maghrib",
  isha: "Isha",
};

export interface PrayerEntry {
  name: TimeName;
  label: string;
  time: string;
  timestamp: number | null;
  isPassed: boolean;
  isNext: boolean;
  countdown: string | null;
}

export interface NextPrayerInfo {
  name: TimeName;
  label: string;
  time: string;
  timestamp: number;
  countdown: string | null;
  tomorrow: boolean;
}

export interface NextEventInfo {
  key: string;
  name: string;
  isToday: boolean;
  daysLeft: number;
}

export interface PrayerTimesPayload {
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
  date: string;
  lang: Lang;
  now: number;
  prayers: PrayerEntry[];
  nextPrayer: NextPrayerInfo | null;
  hijriDate: string;
  nextEvent: NextEventInfo | null;
  tomorrowFajr: number | null;
  /** Yesterday's Isha — anchors the pre-Fajr ring interval (Isha→Fajr across midnight). */
  yesterdayIsha: number | null;
}

export interface BuildPayloadInput {
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
  /** Optional explicit civil date (YYYY-MM-DD); default today in tz. */
  date?: string;
  /** Injected clock for tests; defaults to new Date(). */
  now?: Date;
}

function tsOrNull(d: Date): number | null {
  return isValidDate(d) ? d.getTime() : null;
}

export function buildPrayerTimesPayload(input: BuildPayloadInput): PrayerTimesPayload {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const anchor = input.date ? instantForCivilDate(input.date, input.tz) : now;

  const today: PrayerTimesResult = computePrayerTimes({
    lat: input.lat,
    lon: input.lon,
    elevation: input.elevation,
    tz: input.tz,
    method: input.method,
    asr: input.asr,
    date: anchor,
  });

  // Tomorrow anchored from today's solar noon (always valid, DST-safe).
  const tomorrowAnchor = new Date(today.dhuhr.getTime() + DAY_MS);
  const tomorrow = computePrayerTimes({
    lat: input.lat,
    lon: input.lon,
    elevation: input.elevation,
    tz: input.tz,
    method: input.method,
    asr: input.asr,
    date: tomorrowAnchor,
  });

  // Yesterday, anchored the same way — supplies yesterday's Isha so the client can
  // draw the pre-Fajr ring interval (Isha→Fajr) that spans midnight.
  const yesterdayAnchor = new Date(today.dhuhr.getTime() - DAY_MS);
  const yesterday = computePrayerTimes({
    lat: input.lat,
    lon: input.lon,
    elevation: input.elevation,
    tz: input.tz,
    method: input.method,
    asr: input.asr,
    date: yesterdayAnchor,
  });

  const prayers: PrayerEntry[] = PRAYER_ORDER.map((name) => {
    const d = today[name];
    const ts = tsOrNull(d);
    const isPassed = ts != null && ts <= nowMs;
    return {
      name,
      label: LABELS[name],
      time: fmtTime(d, input.tz, input.lang),
      timestamp: ts,
      isPassed,
      isNext: false,
      countdown: ts != null && ts > nowMs ? fmtCountdown(ts - nowMs) : null,
    };
  });

  // Next = first upcoming of today's six; else tomorrow's Fajr.
  let nextPrayer: NextPrayerInfo | null = null;
  const upcoming = prayers.find((p) => p.timestamp != null && p.timestamp > nowMs);
  if (upcoming) {
    upcoming.isNext = true;
    nextPrayer = {
      name: upcoming.name,
      label: upcoming.label,
      time: upcoming.time,
      timestamp: upcoming.timestamp as number,
      countdown: upcoming.countdown,
      tomorrow: false,
    };
  } else {
    const tf = tsOrNull(tomorrow.fajr);
    if (tf != null) {
      nextPrayer = {
        name: "fajr",
        label: LABELS.fajr,
        time: fmtTime(tomorrow.fajr, input.tz, input.lang),
        timestamp: tf,
        countdown: fmtCountdown(tf - nowMs),
        tomorrow: true,
      };
    }
  }

  // Event scan anchored on the computed day's solar noon.
  const eventAnchor = isValidDate(today.dhuhr) ? today.dhuhr : anchor;

  return {
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
    date: dateKey(anchor, input.tz),
    lang: input.lang,
    now: nowMs,
    prayers,
    nextPrayer,
    hijriDate: hijriDate(anchor, input.tz, input.lang),
    nextEvent: nextIslamicEvent(eventAnchor, input.tz, input.lang),
    tomorrowFajr: tsOrNull(tomorrow.fajr),
    yesterdayIsha: tsOrNull(yesterday.isha),
  };
}
