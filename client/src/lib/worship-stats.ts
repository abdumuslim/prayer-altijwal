// Derived records over the worship state, pure: today's live score, the
// per-section completion streaks, best day, the day/month chart series and
// lifetime totals. Nothing here is persisted — always recomputed from raw
// marks so edits to today can never leave a stale cache behind.

import { addDays, monthKeyOf, prevDayKey } from "@/lib/civil-day";
import {
  WORSHIP_SECTIONS,
  isPerfectDay,
  scoreDay,
  sectionComplete,
  type DayKey,
  type DayLog,
  type MonthAggregate,
  type MonthKey,
  type PrefixStreak,
  type WorshipSection,
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

/** One day's bar in a daily chart series. */
export interface DayScore {
  dayKey: DayKey;
  score: number;
}

/** One month's bar in the months chart series. */
export interface MonthScore {
  monthKey: MonthKey;
  points: number;
  daysLogged: number;
}

export interface WorshipStats {
  todayScore: number;
  /** Per-section consecutive-completion streak ending today or yesterday. */
  streaks: Record<WorshipSection, number>;
  bestDayScore: number;
  /** Key of the best retained day; null when the best lives in a month fold. */
  bestDayKey: DayKey | null;
  /** Exactly 7 entries, oldest → newest (today last), zero-filled. */
  last7: DayScore[];
  /** Exactly 30 entries, oldest → newest (today last), zero-filled. */
  last30: DayScore[];
  /** Up to 12 most-recent months, oldest → newest (folds + retained days). */
  monthly: MonthScore[];
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

/**
 * A section's consecutive-completion streak: walk backwards from today (if that
 * section is already complete today) or yesterday while the section stays
 * complete, then extend through the compacted prefix run when it ends exactly
 * where the walk stopped.
 */
function chainStreak(
  state: WorshipState,
  todayKey: DayKey,
  section: WorshipSection,
  prefix: PrefixStreak,
): number {
  const today = state.days[todayKey];
  let k = today && sectionComplete(today, section) ? todayKey : prevDayKey(todayKey);
  let streak = 0;
  for (let log = state.days[k]; log && sectionComplete(log, section); ) {
    streak++;
    k = prevDayKey(k);
    log = state.days[k];
  }
  if (prefix && prefix.end === k) streak += prefix.length;
  return streak;
}

/** One pass over ≤RETAIN_DAYS retained days + the month folds. */
export function deriveStats(state: WorshipState, todayKey: DayKey): WorshipStats {
  const today = state.days[todayKey];
  const todayScore = today ? scoreDay(today) : 0;

  const streaks = Object.fromEntries(
    WORSHIP_SECTIONS.map((s) => [s, chainStreak(state, todayKey, s, state.prefixStreaks[s])]),
  ) as Record<WorshipSection, number>;

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

  const dayScore = (dayKey: DayKey): DayScore => {
    const log = state.days[dayKey];
    return { dayKey, score: log ? scoreDay(log) : 0 };
  };
  const last7 = Array.from({ length: 7 }, (_, i) => dayScore(addDays(todayKey, i - 6)));
  const last30 = Array.from({ length: 30 }, (_, i) => dayScore(addDays(todayKey, i - 29)));

  // Monthly series: month folds plus retained days grouped by month (a month can
  // straddle the compaction horizon), the 12 most recent, oldest → newest.
  const monthMap = new Map<MonthKey, { points: number; daysLogged: number }>();
  for (const [mk, m] of Object.entries(state.months)) {
    monthMap.set(mk, { points: m.totalPoints, daysLogged: m.daysLogged });
  }
  for (const [dayKey, log] of Object.entries(state.days)) {
    const mk = monthKeyOf(dayKey);
    const c = dayContribution(log);
    const prev = monthMap.get(mk) ?? { points: 0, daysLogged: 0 };
    monthMap.set(mk, { points: prev.points + c.totalPoints, daysLogged: prev.daysLogged + c.daysLogged });
  }
  const monthly: MonthScore[] = [...monthMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .slice(-12)
    .map(([monthKey, v]) => ({ monthKey, points: v.points, daysLogged: v.daysLogged }));

  return { todayScore, streaks, bestDayScore, bestDayKey, last7, last30, monthly, totals };
}
