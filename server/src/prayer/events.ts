// The Islamic events tracked by the app, keyed by Hijri month/day. Dates use the
// Umm al-Qura calendar (matching the Intl `islamic-umalqura` calendar used for
// display). Each event carries a stable `key` (for client-side i18n) plus
// EN/AR display names. Hijri months: 1=Muharram … 12=Dhul-Hijjah.

export type Lang = "ar" | "en";

export interface IslamicEvent {
  /** Stable machine key for client localization. */
  key: string;
  /** Hijri month (1–12). */
  hMonth: number;
  /** Hijri day-of-month (1–30). */
  hDay: number;
  en: string;
  ar: string;
}

export const ISLAMIC_EVENTS: ReadonlyArray<IslamicEvent> = [
  { key: "islamicNewYear", hMonth: 1, hDay: 1, en: "Islamic New Year", ar: "رأس السنة الهجرية" },
  { key: "ashura", hMonth: 1, hDay: 10, en: "Day of Ashura", ar: "يوم عاشوراء" },
  { key: "mawlid", hMonth: 3, hDay: 12, en: "Mawlid al-Nabi", ar: "المولد النبوي" },
  { key: "israMiraj", hMonth: 7, hDay: 27, en: "Isra and Mi'raj", ar: "الإسراء والمعراج" },
  { key: "midShaban", hMonth: 8, hDay: 15, en: "Mid-Sha'ban", ar: "ليلة النصف من شعبان" },
  { key: "ramadanStart", hMonth: 9, hDay: 1, en: "First of Ramadan", ar: "غرة رمضان" },
  { key: "laylatAlQadr", hMonth: 9, hDay: 27, en: "Laylat al-Qadr", ar: "ليلة القدر" },
  { key: "eidAlFitr", hMonth: 10, hDay: 1, en: "Eid al-Fitr", ar: "عيد الفطر" },
  { key: "arafah", hMonth: 12, hDay: 9, en: "Day of Arafah", ar: "يوم عرفة" },
  { key: "eidAlAdha", hMonth: 12, hDay: 10, en: "Eid al-Adha", ar: "عيد الأضحى" },
];

export function eventName(ev: IslamicEvent, lang: Lang): string {
  return lang === "ar" ? ev.ar : ev.en;
}
