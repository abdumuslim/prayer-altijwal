// Persistence for the worship log: its OWN versioned localStorage envelope
// `prayer.worship.v1` — deliberately NOT part of prayer.app.v1 (that envelope
// is re-parsed on every render by useLocation and rewritten per settings tap;
// a daily-growing log must not ride along, and a corrupt log entry must never
// sink settings/location). Mirrors storage.ts's migrate()/coerce* style:
// entry-level garbage is dropped, envelope-level garbage yields defaults,
// nothing ever throws past loadWorshipState.

import { addDays, monthKeyOf, prevDayKey } from "@/lib/civil-day";
import { dayContribution } from "@/lib/worship-stats";
import {
  ADHKAR_SLOTS,
  DEFAULT_WORSHIP_STATE,
  FARD_PRAYERS,
  RAWATIB_SLOTS,
  RETAIN_DAYS,
  WORSHIP_SECTIONS,
  emptyPrefixStreaks,
  sectionComplete,
  type DayKey,
  type DayLog,
  type MonthAggregate,
  type PrefixStreak,
  type PrefixStreaks,
  type WorshipState,
} from "@/lib/worship-log";

const STORAGE_KEY = "prayer.worship.v1";

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const FARD_STATES = new Set(["unmarked", "home", "masjid", "missed"]);

/** Salvage a stored day: junk fard states → "unmarked"; hopeless → null. */
export function coerceDayLog(raw: unknown): DayLog | null {
  if (!isRecord(raw)) return null;
  const fardRaw = isRecord(raw.fard) ? raw.fard : {};
  const rawatibRaw = isRecord(raw.rawatib) ? raw.rawatib : {};
  const adhkarRaw = isRecord(raw.adhkar) ? raw.adhkar : {};
  return {
    fard: Object.fromEntries(
      FARD_PRAYERS.map((p) => {
        const v = fardRaw[p];
        return [p, typeof v === "string" && FARD_STATES.has(v) ? v : "unmarked"];
      }),
    ) as DayLog["fard"],
    rawatib: Object.fromEntries(
      RAWATIB_SLOTS.map((s) => [s, rawatibRaw[s] === true]),
    ) as DayLog["rawatib"],
    adhkar: Object.fromEntries(
      ADHKAR_SLOTS.map((s) => [s, adhkarRaw[s] === true]),
    ) as DayLog["adhkar"],
    duha: raw.duha === true,
    qiyam: raw.qiyam === true,
    tz: typeof raw.tz === "string" ? raw.tz : "",
  };
}

const AGGREGATE_KEYS = [
  "daysLogged",
  "totalPoints",
  "perfectDays",
  "bestDayScore",
  "masjid",
  "home",
  "missed",
  "rawatib",
  "adhkar",
  "duha",
  "qiyam",
] as const;

/** A month fold is kept only when every field is a finite number. */
function coerceMonthAggregate(raw: unknown): MonthAggregate | null {
  if (!isRecord(raw)) return null;
  const out = {} as Record<(typeof AGGREGATE_KEYS)[number], number>;
  for (const key of AGGREGATE_KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[key] = v;
  }
  return out;
}

/** Coerce any raw envelope to a valid WorshipState. Never throws. */
export function migrate(raw: unknown): WorshipState {
  if (!isRecord(raw)) return { ...DEFAULT_WORSHIP_STATE };

  const days: WorshipState["days"] = {};
  if (isRecord(raw.days)) {
    for (const [key, value] of Object.entries(raw.days)) {
      if (!DAY_KEY_RE.test(key)) continue;
      const log = coerceDayLog(value);
      if (log) days[key] = log;
    }
  }

  const months: WorshipState["months"] = {};
  if (isRecord(raw.months)) {
    for (const [key, value] of Object.entries(raw.months)) {
      if (!MONTH_KEY_RE.test(key)) continue;
      const agg = coerceMonthAggregate(value);
      if (agg) months[key] = agg;
    }
  }

  // Per-section compacted-streak carries. (The old single `prefixStreak` field
  // from before per-section streaks is simply ignored — there is no data older
  // than the feature to migrate.)
  const coercePrefix = (v: unknown): PrefixStreak =>
    isRecord(v) &&
    typeof v.end === "string" &&
    DAY_KEY_RE.test(v.end) &&
    typeof v.length === "number" &&
    Number.isInteger(v.length) &&
    v.length >= 0
      ? { end: v.end, length: v.length }
      : null;

  const psRaw = isRecord(raw.prefixStreaks) ? raw.prefixStreaks : {};
  const prefixStreaks = emptyPrefixStreaks();
  for (const section of WORSHIP_SECTIONS) {
    prefixStreaks[section] = coercePrefix(psRaw[section]);
  }

  const dhikrProgress: WorshipState["dhikrProgress"] = {};
  if (isRecord(raw.dhikrProgress)) {
    for (const slot of ADHKAR_SLOTS) {
      const entry = raw.dhikrProgress[slot];
      if (
        isRecord(entry) &&
        typeof entry.dayKey === "string" &&
        DAY_KEY_RE.test(entry.dayKey) &&
        Array.isArray(entry.counts) &&
        entry.counts.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
      ) {
        dhikrProgress[slot] = {
          dayKey: entry.dayKey,
          counts: (entry.counts as number[]).map((n) => Math.floor(n)),
        };
      }
    }
  }

  return { v: 1, days, months, prefixStreaks, dhikrProgress };
}

export function loadWorshipState(): WorshipState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WORSHIP_STATE };
    return migrate(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_WORSHIP_STATE };
  }
}

export function saveWorshipState(state: WorshipState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full / disabled (private mode) — app keeps working in-memory
  }
}

/**
 * Fold every retained day older than today−RETAIN_DAYS into its month
 * aggregate, advance prefixStreak, and drop stale dhikr progress. Pure and
 * idempotent; stats derived before and after are identical (compaction is
 * lossless for totals/best/perfect and for streaks via prefixStreak).
 */
export function compact(state: WorshipState, todayKey: DayKey): WorshipState {
  const horizon = addDays(todayKey, -RETAIN_DAYS);
  // ISO day keys compare correctly as strings; fold oldest-first so the
  // prefixStreak walk sees days in calendar order.
  const foldKeys = Object.keys(state.days)
    .filter((k) => k < horizon)
    .sort();

  const days = { ...state.days };
  const months = { ...state.months };
  const prefixStreaks: PrefixStreaks = { ...state.prefixStreaks };

  for (const key of foldKeys) {
    const log = days[key];
    delete days[key];

    const c = dayContribution(log);
    const mk = monthKeyOf(key);
    const prev = months[mk];
    months[mk] = prev
      ? {
          daysLogged: prev.daysLogged + c.daysLogged,
          totalPoints: prev.totalPoints + c.totalPoints,
          perfectDays: prev.perfectDays + c.perfectDays,
          bestDayScore: Math.max(prev.bestDayScore, c.bestDayScore),
          masjid: prev.masjid + c.masjid,
          home: prev.home + c.home,
          missed: prev.missed + c.missed,
          rawatib: prev.rawatib + c.rawatib,
          adhkar: prev.adhkar + c.adhkar,
          duha: prev.duha + c.duha,
          qiyam: prev.qiyam + c.qiyam,
        }
      : c;

    // Advance each section's compacted run independently: a complete day extends
    // it only when calendar-contiguous with the previous fold; otherwise it
    // restarts (or zeroes on an incomplete day).
    for (const section of WORSHIP_SECTIONS) {
      const prevRun = prefixStreaks[section];
      if (sectionComplete(log, section)) {
        prefixStreaks[section] =
          prevRun && prevRun.end === prevDayKey(key)
            ? { end: key, length: prevRun.length + 1 }
            : { end: key, length: 1 };
      } else {
        prefixStreaks[section] = { end: key, length: 0 };
      }
    }
  }

  // Dhikr progress from any previous day is meaningless — drop it.
  const dhikrProgress = Object.fromEntries(
    Object.entries(state.dhikrProgress).filter(([, v]) => v && v.dayKey === todayKey),
  ) as WorshipState["dhikrProgress"];

  return { v: 1, days, months, prefixStreaks, dhikrProgress };
}
