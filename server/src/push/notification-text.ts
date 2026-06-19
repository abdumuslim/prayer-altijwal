// Localized push notification text. Built server-side (the scheduler has the
// language) and sent as { title, body } so the service worker just renders it.
// Numerals stay Latin to match the app ("keep numbers in English").

type Lang = "ar" | "en";

const PRAYER_NAMES: Record<Lang, Record<string, string>> = {
  ar: {
    fajr: "الفجر",
    dhuhr: "الظهر",
    asr: "العصر",
    maghrib: "المغرب",
    isha: "العشاء",
  },
  en: {
    fajr: "Fajr",
    dhuhr: "Dhuhr",
    asr: "Asr",
    maghrib: "Maghrib",
    isha: "Isha",
  },
};

export interface PushPayload {
  title: string;
  body: string;
  prayer: string;
  lead: number;
  lang: Lang;
}

/** Build the notification payload for a prayer reminder. */
export function buildPushPayload(prayer: string, lead: number, lang: string): PushPayload {
  const l: Lang = lang === "en" ? "en" : "ar";
  const name = PRAYER_NAMES[l][prayer] ?? prayer;
  const body =
    lead <= 0
      ? l === "ar"
        ? "حان وقت الصلاة"
        : "It's time to pray"
      : l === "ar"
        ? `بعد ${lead} دقيقة`
        : `in ${lead} minutes`;
  return { title: name, body, prayer, lead, lang: l };
}
