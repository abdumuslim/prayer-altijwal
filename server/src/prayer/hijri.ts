import { ISLAMIC_EVENTS, eventName, type Lang } from "./events.js";

const DAY_MS = 86_400_000;

export interface NextEvent {
  key: string;
  name: string;
  isToday: boolean;
  daysLeft: number;
}

interface HijriParts {
  year: number;
  month: number;
  day: number;
}

/** Hijri (Umm al-Qura) Y/M/D numeric parts for an instant in the given tz. */
export function hijriParts(date: Date, tz: string): HijriParts {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-islamic-umalqura", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Localized Hijri date string (e.g. "Dhuʻl-Hijjah 4, 1447 AH" / Arabic).
 *  Arabic uses `-nu-latn` so the month name is Arabic but the numerals stay
 *  Latin (product decision: "keep numbers in English"). */
export function hijriDate(date: Date, tz: string, lang: Lang): string {
  const locale =
    lang === "ar" ? "ar-SA-u-ca-islamic-umalqura-nu-latn" : "en-US-u-ca-islamic-umalqura";
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * The nearest upcoming (or today's) tracked Islamic event. `anchorNoon` should
 * be a midday instant of the reference civil day (passed by the payload builder,
 * e.g. today's Dhuhr) so that whole-day offsets never flip across a date
 * boundary. Scans up to ~360 days ahead.
 */
export function nextIslamicEvent(anchorNoon: Date, tz: string, lang: Lang): NextEvent | null {
  for (let offset = 0; offset <= 360; offset++) {
    const candidate = new Date(anchorNoon.getTime() + offset * DAY_MS);
    const { month, day } = hijriParts(candidate, tz);
    const ev = ISLAMIC_EVENTS.find((e) => e.hMonth === month && e.hDay === day);
    if (ev) {
      return { key: ev.key, name: eventName(ev, lang), isToday: offset === 0, daysLeft: offset };
    }
  }
  return null;
}
