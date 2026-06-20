// Gregorian date formatting for the header. Arabic uses the Levantine/Iraqi
// (Syriac-derived) month set — حزيران/تموز… — that our audience uses, instead of
// the transliterated يناير/فبراير… set Intl emits for "ar". Numerals stay Latin
// (product rule: keep numbers in English). The month index is taken in the
// TARGET location's tz, never the device tz.

import type { Lang } from "@/types/api";

/** Levantine/Iraqi Gregorian month names, index 0 = January. */
export const LEVANTINE_MONTHS_AR = [
  "كانون الثاني",
  "شباط",
  "آذار",
  "نيسان",
  "أيار",
  "حزيران",
  "تموز",
  "آب",
  "أيلول",
  "تشرين الأول",
  "تشرين الثاني",
  "كانون الأول",
] as const;

/** 0-based Gregorian month of an instant, resolved in the given tz. */
function monthIndexInTz(at: Date, tz: string): number {
  const m = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "numeric" }).format(at);
  return Number(m) - 1;
}

/**
 * Full header date: weekday + day + month. Arabic substitutes the Levantine
 * month name (Latin numerals); English uses the platform default. Returns "" on
 * any formatting failure (mirrors the rest of the date code).
 */
export function gregorianFull(at: Date, tz: string, lang: Lang): string {
  try {
    if (lang === "ar") {
      const weekday = new Intl.DateTimeFormat("ar", { timeZone: tz, weekday: "long" }).format(at);
      const day = new Intl.DateTimeFormat("ar-u-nu-latn", { timeZone: tz, day: "numeric" }).format(at);
      const month = LEVANTINE_MONTHS_AR[monthIndexInTz(at, tz)] ?? "";
      return `${weekday}، ${day} ${month}`;
    }
    return new Intl.DateTimeFormat("en", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(at);
  } catch {
    return "";
  }
}
