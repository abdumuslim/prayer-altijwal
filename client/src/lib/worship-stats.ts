// Derived records over the worship state, pure: today's live score, the
// streak (consecutive score>0 days), best day, the 7-day chart series and
// lifetime totals. Nothing here is persisted — always recomputed from raw
// marks so edits to today can never leave a stale cache behind.

import { addDays, prevDayKey } from "@/lib/civil-day";
import {
  isPerfectDay,
  scoreDay,
  type DayKey,
  type DayLog,
  type MonthAggregate,
  type WorshipState,
} from "@/lib/worship-log";

export interface WorshipTotals {
  points: number;
  daysLogged: number;
  perfectDays: number;
  masjid: number;
  home: number;
  missed: number;
  rawatib: number;
  adhkar: number;
  duha: number;
  qiyam: number;
}

export interface WorshipStats {
  todayScore: number;
  /** Consecutive score>0 days ending today (if positive) or yesterday. */
  streak: number;
  bestDayScore: number;
  /** Key of the best retained day; null when the best lives in a month fold. */
  bestDayKey: DayKey | null;
  /** Exactly 7 entries, oldest → newest (today last), zero-filled. */
  last7: { dayKey: DayKey; score: number }[];
  totals: WorshipTotals;
}

const countTrue = (flags: Record<string, boolean>): number =>
  Object.values(flags).filter(Boolean).length;

const countFard = (log: DayLog, state: "masjid" | "home" | "missed"): number =>
  Object.values(log.fard).filter((s) => s === state).length;

/** Fold one day into MonthAggregate shape (shared with compaction). */
export function dayContribution(log: DayLog): MonthAggregate {
  const score = scoreDay(log);
  return {
    daysLogged: 1,
    totalPoints: score,
    perfectDays: isPerfectDay(log) ? 1 : 0,
    bestDayScore: score,
    masjid: countFard(log, "masjid"),
    home: countFard(log, "home"),
    missed: countFard(log, "missed"),
    rawatib: countTrue(log.rawatib),
    adhkar: countTrue(log.adhkar),
    duha: log.duha ? 1 : 0,
    qiyam: log.qiyam ? 1 : 0,
  };
}

/** One pass over ≤RETAIN_DAYS retained days + the month folds. */
export function deriveStats(state: WorshipState, todayKey: DayKey): WorshipStats {
  const today = state.days[todayKey];
  const todayScore = today ? scoreDay(today) : 0;

  // Streak: walk backwards through retained days from today (if already
  // positive) or yesterday, then extend through the compacted prefix run
  // when it ends exactly where the walk stopped.
  let k = todayScore > 0 ? todayKey : prevDayKey(todayKey);
  let streak = 0;
  for (let log = state.days[k]; log && scoreDay(log) > 0; ) {
    streak++;
    k = prevDayKey(k);
    log = state.days[k];
  }
  if (state.prefixStreak && state.prefixStreak.end === k) {
    streak += state.prefixStreak.length;
  }

  // Totals + best day: month folds first, then every retained day.
  const totals: WorshipTotals = {
    points: 0,
    daysLogged: 0,
    perfectDays: 0,
    masjid: 0,
    home: 0,
    missed: 0,
    rawatib: 0,
    adhkar: 0,
    duha: 0,
    qiyam: 0,
  };
  let bestDayScore = 0;
  let bestDayKey: DayKey | null = null;

  for (const m of Object.values(state.months)) {
    totals.points += m.totalPoints;
    totals.daysLogged += m.daysLogged;
    totals.perfectDays += m.perfectDays;
    totals.masjid += m.masjid;
    totals.home += m.home;
    totals.missed += m.missed;
    totals.rawatib += m.rawatib;
    totals.adhkar += m.adhkar;
    totals.duha += m.duha;
    totals.qiyam += m.qiyam;
    if (m.bestDayScore > bestDayScore) {
      bestDayScore = m.bestDayScore;
      bestDayKey = null; // the record lives in a fold — no day key survives
    }
  }
  for (const [dayKey, log] of Object.entries(state.days)) {
    const c = dayContribution(log);
    totals.points += c.totalPoints;
    totals.daysLogged += c.daysLogged;
    totals.perfectDays += c.perfectDays;
    totals.masjid += c.masjid;
    totals.home += c.home;
    totals.missed += c.missed;
    totals.rawatib += c.rawatib;
    totals.adhkar += c.adhkar;
    totals.duha += c.duha;
    totals.qiyam += c.qiyam;
    if (c.bestDayScore > bestDayScore) {
      bestDayScore = c.bestDayScore;
      bestDayKey = dayKey;
    }
  }

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const dayKey = addDays(todayKey, i - 6);
    const log = state.days[dayKey];
    return { dayKey, score: log ? scoreDay(log) : 0 };
  });

  return { todayScore, streak, bestDayScore, bestDayKey, last7, totals };
}
