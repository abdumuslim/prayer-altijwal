// Pure per-day worship-log core: the stored day shape, the 29-point scoring
// rubric, and immutable mark application. No storage, no React, no clocks —
// the house style of hero-extras.ts. Consumed by worship-storage/-stats and
// the useWorshipLog hook.

import type { PrayerName } from "@/types/api";

export type FardPrayer = Exclude<PrayerName, "sunrise">;
export type FardState = "unmarked" | "home" | "masjid" | "missed";

export const FARD_PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;

export const RAWATIB_SLOTS = [
  "beforeFajr",
  "beforeDhuhr",
  "afterDhuhr",
  "afterMaghrib",
  "afterIsha",
] as const;
export type RawatibSlot = (typeof RAWATIB_SLOTS)[number];

/** Rakaat per rawatib slot (12 total — the famous daily sunnah count). */
export const RAWATIB_RAKAAT: Record<RawatibSlot, number> = {
  beforeFajr: 2,
  beforeDhuhr: 4,
  afterDhuhr: 2,
  afterMaghrib: 2,
  afterIsha: 2,
};

export const ADHKAR_SLOTS = [
  "afterFajr",
  "afterDhuhr",
  "afterAsr",
  "afterMaghrib",
  "afterIsha",
  "morning",
  "evening",
] as const;
export type AdhkarSlot = (typeof ADHKAR_SLOTS)[number];

export const FARD_POINTS: Record<FardState, number> = {
  masjid: 3,
  home: 2,
  missed: -1,
  unmarked: 0,
};

/** 5×3 fard + 5 rawatib + 7 adhkar + duha + qiyam. */
export const PERFECT_DAY_SCORE = 29;

/** "YYYY-MM-DD" in the location tz (see lib/civil-day.ts). */
export type DayKey = string;
export type MonthKey = string;

export interface DayLog {
  fard: Record<FardPrayer, FardState>;
  rawatib: Record<RawatibSlot, boolean>;
  adhkar: Record<AdhkarSlot, boolean>;
  duha: boolean;
  qiyam: boolean;
  /** tz that last wrote this day — provenance only, never used for lookups. */
  tz: string;
}

/** Per-month fold of compacted (locked, >62-day-old) days — ~11 numbers. */
export interface MonthAggregate {
  daysLogged: number;
  totalPoints: number;
  perfectDays: number;
  bestDayScore: number;
  masjid: number;
  home: number;
  missed: number;
  rawatib: number;
  adhkar: number;
  duha: number;
  qiyam: number;
}

/** In-progress tap counts for one adhkar list (resume after app close). */
export interface DhikrProgress {
  dayKey: DayKey;
  counts: number[];
}

/** The `prayer.worship.v1` localStorage envelope (see worship-storage.ts). */
export interface WorshipState {
  v: 1;
  /** Full detail for the most recent ≤ RETAIN_DAYS days. */
  days: Record<DayKey, DayLog>;
  /** Everything older, folded per month — kept forever. */
  months: Record<MonthKey, MonthAggregate>;
  /** Consecutive score>0 run ending exactly at the newest compacted day. */
  prefixStreak: { end: DayKey; length: number } | null;
  /** Entries with a stale dayKey are dropped on load/rollover. */
  dhikrProgress: Partial<Record<AdhkarSlot, DhikrProgress>>;
}

export const RETAIN_DAYS = 62;

export const DEFAULT_WORSHIP_STATE: WorshipState = {
  v: 1,
  days: {},
  months: {},
  prefixStreak: null,
  dhikrProgress: {},
};

export type WorshipMark =
  | { kind: "fard"; prayer: FardPrayer; state: FardState }
  | { kind: "rawatib"; slot: RawatibSlot; done: boolean }
  | { kind: "adhkar"; slot: AdhkarSlot; done: boolean }
  | { kind: "duha" | "qiyam"; done: boolean };

/** A fresh, fully unmarked day. */
export function emptyDayLog(tz: string): DayLog {
  return {
    fard: { fajr: "unmarked", dhuhr: "unmarked", asr: "unmarked", maghrib: "unmarked", isha: "unmarked" },
    rawatib: { beforeFajr: false, beforeDhuhr: false, afterDhuhr: false, afterMaghrib: false, afterIsha: false },
    adhkar: { afterFajr: false, afterDhuhr: false, afterAsr: false, afterMaghrib: false, afterIsha: false, morning: false, evening: false },
    duha: false,
    qiyam: false,
    tz,
  };
}

/** Apply a mark immutably — returns a new DayLog, never touches the input. */
export function applyMark(log: DayLog, mark: WorshipMark): DayLog {
  switch (mark.kind) {
    case "fard":
      return { ...log, fard: { ...log.fard, [mark.prayer]: mark.state } };
    case "rawatib":
      return { ...log, rawatib: { ...log.rawatib, [mark.slot]: mark.done } };
    case "adhkar":
      return { ...log, adhkar: { ...log.adhkar, [mark.slot]: mark.done } };
    case "duha":
      return { ...log, duha: mark.done };
    case "qiyam":
      return { ...log, qiyam: mark.done };
  }
}

const countTrue = (flags: Record<string, boolean>): number =>
  Object.values(flags).filter(Boolean).length;

/** The day's points under the 29-point rubric (can be negative, floor −5). */
export function scoreDay(log: DayLog): number {
  const fard = Object.values(log.fard).reduce((sum, s) => sum + FARD_POINTS[s], 0);
  return (
    fard +
    countTrue(log.rawatib) +
    countTrue(log.adhkar) +
    (log.duha ? 1 : 0) +
    (log.qiyam ? 1 : 0)
  );
}

export function isPerfectDay(log: DayLog): boolean {
  return scoreDay(log) === PERFECT_DAY_SCORE;
}
