// Pure view-model derivation for the hero's worship widgets (house style of
// hero-extras.ts): the two corner rings' progress/caption/active state and
// the contextual check-in prayer. No React, no clocks of its own — everything
// derives from (today, dhikrProgress, prayers, now).

import { ADHKAR_LISTS, listProgress } from "@/lib/adhkar-data";
import {
  RAWATIB_RAKAAT,
  RAWATIB_SLOTS,
  type DayLog,
  type FardPrayer,
  type WorshipMark,
  type WorshipState,
} from "@/lib/worship-log";
import type { PrayerName } from "@/types/api";
import type { StringKey } from "@/i18n/strings.en";

export interface CornerVM {
  /** Text inside the ring while in progress, e.g. "6/12" or "1/2". */
  centerText: string;
  /** 0..1 arc fill. */
  progress: number;
  /** Fully done → filled disc + check. */
  complete: boolean;
  /** Something is actionable right now → glow. */
  active: boolean;
  /** i18n key for the caption under the ring. */
  captionKey: StringKey;
}

type Prayers = { name: PrayerName; timestamp: number | null }[];
type CanMark = (mark: WorshipMark) => boolean;

export function deriveRawatibCorner(today: DayLog, canMark: CanMark): CornerVM {
  const doneRakaat = RAWATIB_SLOTS.reduce(
    (sum, s) => sum + (today.rawatib[s] ? RAWATIB_RAKAAT[s] : 0),
    0,
  );
  const firstPending = RAWATIB_SLOTS.find((s) => !today.rawatib[s]);
  const active = RAWATIB_SLOTS.some(
    (s) => !today.rawatib[s] && canMark({ kind: "rawatib", slot: s, done: true }),
  );
  return {
    centerText: `${doneRakaat}/12`,
    progress: doneRakaat / 12,
    complete: firstPending === undefined,
    active,
    captionKey: firstPending ? (`rawatib.${firstPending}` as StringKey) : "track.done",
  };
}

export function deriveAdhkarCorner(
  today: DayLog,
  dhikrProgress: WorshipState["dhikrProgress"],
  prayers: Prayers,
  now: number,
): CornerVM {
  const counts = (slot: "morning" | "evening"): number[] =>
    dhikrProgress[slot]?.counts ?? [];
  // A slot counts fully once marked done; otherwise its arc share moves with
  // each individual dhikr completed inside the list (user rule).
  const share = (slot: "morning" | "evening"): number =>
    today.adhkar[slot] ? 1 : listProgress(counts(slot), ADHKAR_LISTS[slot]);

  const ts = (name: PrayerName): number | null =>
    prayers.find((p) => p.name === name)?.timestamp ?? null;
  const fajrTs = ts("fajr");
  const asrTs = ts("asr");
  const morningWindow = fajrTs != null && asrTs != null && now >= fajrTs && now < asrTs;
  const eveningWindow = asrTs != null && now >= asrTs;

  const dailyDone = (today.adhkar.morning ? 1 : 0) + (today.adhkar.evening ? 1 : 0);
  const complete = dailyDone === 2;
  const active =
    (morningWindow && !today.adhkar.morning) || (eveningWindow && !today.adhkar.evening);

  const captionKey: StringKey = complete
    ? "track.done"
    : eveningWindow && !today.adhkar.evening
      ? "adhkar.eveningNow"
      : morningWindow && !today.adhkar.morning
        ? "adhkar.morningNow"
        : !today.adhkar.morning
          ? "adhkar.morning"
          : "adhkar.evening";

  return {
    centerText: `${dailyDone}/2`,
    progress: (share("morning") + share("evening")) / 2,
    complete,
    active,
    captionKey,
  };
}

const FARD_ORDER: FardPrayer[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/** The latest fard whose adhan has passed today — the contextual check-in target. */
export function deriveCheckinPrayer(prayers: Prayers, now: number): FardPrayer | null {
  let latest: FardPrayer | null = null;
  for (const name of FARD_ORDER) {
    const ts = prayers.find((p) => p.name === name)?.timestamp;
    if (ts != null && ts <= now) latest = name;
  }
  return latest;
}
