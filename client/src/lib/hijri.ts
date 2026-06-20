// Hijri (Umm al-Qura) date formatting on the client. Mirrors the server's
// hijriDate() locale choices so client-derived dates (e.g. the next event)
// match the server-rendered Hijri date in the header: Arabic month names with
// Latin numerals (-nu-latn) in Arabic, en-US otherwise.

import type { Lang } from "@/types/api";

/**
 * Day + month in the Hijri calendar for an instant in the given tz (no year —
 * keeps the compact event row short, parallel to the old Gregorian "20 Jun").
 * Returns "" on any formatting failure.
 */
export function hijriDayMonth(date: Date, tz: string, lang: Lang): string {
  const locale =
    lang === "ar" ? "ar-SA-u-ca-islamic-umalqura-nu-latn" : "en-US-u-ca-islamic-umalqura";
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      day: "numeric",
      month: "long",
    }).format(date);
  } catch {
    return "";
  }
}
