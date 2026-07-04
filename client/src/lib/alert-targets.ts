// Reminder-rule target metadata: the ordered picker groups and each target's
// label key (reusing existing approved strings). Shared by the rule form and the
// rule-list description so labels stay in one place.

import type { AlertTarget } from "@/types/api";
import type { StringKey } from "@/i18n/strings.en";

/** The five fard — offered first; selecting all of them means "all prayers". */
export const FARD_TARGETS: AlertTarget[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/** Sunnah + adhkar anchors — offered as a second group. */
export const EXTRA_TARGETS: AlertTarget[] = ["duha", "qiyam", "adhkar_morning", "adhkar_evening"];

/** i18n key for each target's label. Config surfaces keep الظهر (never الجمعة). */
export const ALERT_TARGET_LABEL: Record<AlertTarget, StringKey> = {
  fajr: "prayer.fajr",
  dhuhr: "prayer.dhuhr",
  asr: "prayer.asr",
  maghrib: "prayer.maghrib",
  isha: "prayer.isha",
  duha: "sunnah.duha",
  qiyam: "sunnah.qiyam",
  adhkar_morning: "adhkar.morning",
  adhkar_evening: "adhkar.evening",
};

/** True when a rule's target set contains every fard prayer (⇒ "all prayers"). */
export function coversAllFard(targets: readonly AlertTarget[]): boolean {
  const set = new Set(targets);
  return FARD_TARGETS.every((p) => set.has(p));
}
