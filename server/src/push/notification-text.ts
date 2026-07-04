// Localized push notification text. Built server-side (the scheduler has the
// language) and sent as { title, body } so the service worker just renders it.
// Numerals stay Latin to match the app ("keep numbers in English").

type Lang = "ar" | "en";

/** Notification titles per target. `jumuah` is the Friday face of `dhuhr`. */
const TITLES: Record<Lang, Record<string, string>> = {
  ar: {
    fajr: "الفجر",
    dhuhr: "الظهر",
    jumuah: "الجمعة",
    asr: "العصر",
    maghrib: "المغرب",
    isha: "العشاء",
    duha: "صلاة الضحى",
    qiyam: "قيام الليل",
    adhkar_morning: "أذكار الصباح",
    adhkar_evening: "أذكار المساء",
  },
  en: {
    fajr: "Fajr",
    dhuhr: "Dhuhr",
    jumuah: "Jumu'ah",
    asr: "Asr",
    maghrib: "Maghrib",
    isha: "Isha",
    duha: "Duha prayer",
    qiyam: "Night prayer",
    adhkar_morning: "Morning adhkar",
    adhkar_evening: "Evening adhkar",
  },
};

const FARD = new Set(["fajr", "dhuhr", "asr", "maghrib", "isha"]);

/** At-time (lead === 0) body per target; the five fard share one phrase. */
const AT_TIME_BODY: Record<Lang, Record<string, string>> = {
  ar: {
    _prayer: "حان وقت الصلاة",
    duha: "بدأ وقت الضحى",
    qiyam: "بدأ الثلث الأخير من الليل",
    adhkar_morning: "حان وقت أذكار الصباح",
    adhkar_evening: "حان وقت أذكار المساء",
  },
  en: {
    _prayer: "It's time to pray",
    duha: "Duha time has begun",
    qiyam: "The last third of the night has begun",
    adhkar_morning: "Time for morning adhkar",
    adhkar_evening: "Time for evening adhkar",
  },
};

export interface PushPayload {
  title: string;
  body: string;
  prayer: string;
  lead: number;
  lang: Lang;
}

export interface PushPayloadOptions {
  /** The target instant falls on a Friday → dhuhr is shown as الجمعة. */
  friday?: boolean;
}

/**
 * Build the notification payload for a reminder. `lead` is the signed offset in
 * minutes: 0 = at time, +N = fired N min before, −N = fired N min after.
 */
export function buildPushPayload(
  prayer: string,
  lead: number,
  lang: string,
  opts: PushPayloadOptions = {},
): PushPayload {
  const l: Lang = lang === "en" ? "en" : "ar";
  const titleKey = opts.friday && prayer === "dhuhr" ? "jumuah" : prayer;
  const title = TITLES[l][titleKey] ?? prayer;

  const n = Math.abs(lead);
  let body: string;
  if (lead > 0) {
    body = l === "ar" ? `بعد ${n} دقيقة` : `in ${n} minutes`;
  } else if (lead < 0) {
    body = l === "ar" ? `منذ ${n} دقيقة` : `${n} minutes ago`;
  } else {
    body = AT_TIME_BODY[l][FARD.has(prayer) ? "_prayer" : prayer] ?? AT_TIME_BODY[l]._prayer;
  }

  return { title, body, prayer, lead, lang: l };
}
