// Marking-window enforcement, pure. A mark is allowed once its "parent"
// prayer's adhan has passed (the قبل rawatib are prayed between adhan and
// iqama, so the adhan gate is correct for them too), and only while the day
// being edited is still the current civil day in the LOCATION's tz — that
// single comparison IS the midnight lock. Null timestamps (high-latitude
// fallback timetables) degrade the gate to "markable all civil day".

import { localDayKey } from "@/lib/civil-day";
import type { PrayerName } from "@/types/api";
import type { DayKey, FardPrayer, WorshipMark } from "@/lib/worship-log";

/** True while `dayKey` is the current civil day in the location tz. */
export function isEditableDay(dayKey: DayKey, tz: string, now: number): boolean {
  return dayKey === localDayKey(tz, now);
}

const RAWATIB_PARENT: Record<string, FardPrayer> = {
  beforeFajr: "fajr",
  beforeDhuhr: "dhuhr",
  afterDhuhr: "dhuhr",
  afterMaghrib: "maghrib",
  afterIsha: "isha",
};

const ADHKAR_PARENT: Record<string, FardPrayer> = {
  afterFajr: "fajr",
  afterDhuhr: "dhuhr",
  afterAsr: "asr",
  afterMaghrib: "maghrib",
  afterIsha: "isha",
  morning: "fajr", // the day window opens at fajr
  evening: "asr", // …and the night window at asr (user's mapping)
};

/** The prayer whose adhan gates this mark; null = markable all day. */
export function parentPrayerOf(mark: WorshipMark): FardPrayer | null {
  switch (mark.kind) {
    case "fard":
      return mark.prayer;
    case "rawatib":
      return RAWATIB_PARENT[mark.slot];
    case "adhkar":
      return ADHKAR_PARENT[mark.slot];
    default:
      return null; // duha / qiyam — self-reported all day
  }
}

/** True when the mark's gate has opened (parent adhan passed / no gate). */
export function canMark(
  mark: WorshipMark,
  prayers: { name: PrayerName; timestamp: number | null }[],
  now: number,
): boolean {
  const parent = parentPrayerOf(mark);
  if (parent === null) return true;
  const ts = prayers.find((p) => p.name === parent)?.timestamp;
  // Unknown/null adhan (high-latitude fallback) must never block the user.
  if (ts == null) return true;
  return now >= ts;
}
