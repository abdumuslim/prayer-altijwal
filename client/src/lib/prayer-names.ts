// Friday-aware prayer-name localization. On Fridays the ظهر congregation is the
// Jumu'ah prayer — there is no ordinary Dhuhr in the masjid — so the "dhuhr"
// label reads "الجمعة" on that civil day only, everywhere a TODAY prayer name is
// shown (cards, hero ring, check-in question, iqama bar, after-prayer adhkar).
// The DayKey is the civil date in the LOCATION tz, so this flips at local
// midnight, not the device's.

import type { PrayerName } from "@/types/api";
import type { StringKey } from "@/i18n/strings.en";

/** True when the civil-day key (YYYY-MM-DD) falls on a Friday. */
export function isFridayKey(dayKey: string): boolean {
  // A DayKey is a plain calendar date; read its weekday at UTC (matches the
  // StatsSheet chart idiom). 5 = Friday.
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay() === 5;
}

/** i18n key for a prayer's name, substituting الجمعة for dhuhr on Fridays. */
export function prayerNameKey(name: PrayerName, friday: boolean): StringKey {
  return friday && name === "dhuhr" ? "prayer.jumuah" : (`prayer.${name}` as StringKey);
}
