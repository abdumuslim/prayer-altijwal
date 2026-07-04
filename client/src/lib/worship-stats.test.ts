import { describe, expect, test } from "vitest";
import { dayContribution, deriveStats } from "./worship-stats";
import {
  DEFAULT_WORSHIP_STATE,
  FARD_PRAYERS,
  RAWATIB_SLOTS,
  applyMark,
  emptyDayLog,
  emptyPrefixStreaks,
  type DayLog,
  type PrefixStreaks,
  type WorshipMark,
  type WorshipState,
} from "./worship-log";

const TZ = "Asia/Baghdad";
const TODAY = "2026-07-03";

const dayWith = (marks: WorshipMark[]): DayLog =>
  marks.reduce((acc, m) => applyMark(acc, m), emptyDayLog(TZ));

/** A day complete in every section (all fard, all rawatib, both adhkar, both sunan). */
const completeAll = (): DayLog =>
  dayWith([
    ...FARD_PRAYERS.map((p) => ({ kind: "fard", prayer: p, state: "masjid" }) as WorshipMark),
    ...RAWATIB_SLOTS.map((s) => ({ kind: "rawatib", slot: s, done: true }) as WorshipMark),
    { kind: "adhkar", slot: "morning", done: true },
    { kind: "adhkar", slot: "evening", done: true },
    { kind: "duha", done: true },
    { kind: "qiyam", done: true },
  ]);

/** All five fard prayed (masjid) — fard-complete, nothing else. */
const completeFard = (): DayLog =>
  dayWith(FARD_PRAYERS.map((p) => ({ kind: "fard", prayer: p, state: "masjid" }) as WorshipMark));

const withPrefix = (section: keyof PrefixStreaks, end: string, length: number): PrefixStreaks => ({
  ...emptyPrefixStreaks(),
  [section]: { end, length },
});

const stateWith = (days: Record<string, DayLog>, extra?: Partial<WorshipState>): WorshipState => ({
  ...DEFAULT_WORSHIP_STATE,
  days,
  ...extra,
});

describe("dayContribution", () => {
  test("folds one day into aggregate shape", () => {
    const log = dayWith([
      { kind: "fard", prayer: "fajr", state: "masjid" },
      { kind: "fard", prayer: "dhuhr", state: "home" },
      { kind: "fard", prayer: "asr", state: "missed" },
      { kind: "rawatib", slot: "beforeFajr", done: true },
      { kind: "adhkar", slot: "morning", done: true },
      { kind: "duha", done: true },
    ]);
    expect(dayContribution(log)).toEqual({
      daysLogged: 1,
      totalPoints: 7, // 3+2−1+1+1+1
      perfectDays: 0,
      bestDayScore: 7,
      masjid: 1,
      home: 1,
      missed: 1,
      rawatib: 1,
      adhkar: 1,
      duha: 1,
      qiyam: 0,
    });
  });
});

describe("deriveStats — per-section streaks", () => {
  test("fard streak includes today when today is already complete", () => {
    const s = stateWith({
      [TODAY]: completeFard(),
      "2026-07-02": completeFard(),
      "2026-07-01": completeFard(),
    });
    expect(deriveStats(s, TODAY).streaks.fard).toBe(3);
  });

  test("fard streak anchors at yesterday while today is still incomplete", () => {
    const s = stateWith({
      "2026-07-02": completeFard(),
      "2026-07-01": completeFard(),
    });
    expect(deriveStats(s, TODAY).streaks.fard).toBe(2);
  });

  test("fard streak is broken by a missed prayer", () => {
    const s = stateWith({
      [TODAY]: completeFard(),
      "2026-07-02": dayWith([
        { kind: "fard", prayer: "fajr", state: "masjid" },
        { kind: "fard", prayer: "dhuhr", state: "masjid" },
        { kind: "fard", prayer: "asr", state: "masjid" },
        { kind: "fard", prayer: "maghrib", state: "masjid" },
        { kind: "fard", prayer: "isha", state: "missed" },
      ]),
      "2026-07-01": completeFard(),
    });
    expect(deriveStats(s, TODAY).streaks.fard).toBe(1);
  });

  test("fard streak is broken by an unmarked prayer (not just missed)", () => {
    const s = stateWith({
      [TODAY]: completeFard(),
      "2026-07-02": dayWith([
        { kind: "fard", prayer: "fajr", state: "masjid" },
        { kind: "fard", prayer: "dhuhr", state: "masjid" },
        { kind: "fard", prayer: "asr", state: "masjid" },
        { kind: "fard", prayer: "maghrib", state: "masjid" },
        // isha left unmarked
      ]),
      "2026-07-01": completeFard(),
    });
    expect(deriveStats(s, TODAY).streaks.fard).toBe(1);
  });

  test("rawatib streak requires all five slots", () => {
    const fourSlots = dayWith(
      RAWATIB_SLOTS.slice(0, 4).map((slot) => ({ kind: "rawatib", slot, done: true }) as WorshipMark),
    );
    const s = stateWith({ [TODAY]: completeAll(), "2026-07-02": fourSlots });
    expect(deriveStats(s, TODAY).streaks.rawatib).toBe(1);
  });

  test("adhkar streak counts the daily pair, not after-prayer slots", () => {
    const onlyAfter = dayWith([
      { kind: "adhkar", slot: "afterFajr", done: true },
      { kind: "adhkar", slot: "afterDhuhr", done: true },
      { kind: "adhkar", slot: "morning", done: true },
      // evening missing → pair incomplete
    ]);
    const s = stateWith({ [TODAY]: onlyAfter });
    expect(deriveStats(s, TODAY).streaks.adhkar).toBe(0);
  });

  test("sunan streak requires both duha and qiyam", () => {
    const onlyDuha = dayWith([{ kind: "duha", done: true }]);
    const s = stateWith({ [TODAY]: onlyDuha });
    expect(deriveStats(s, TODAY).streaks.sunan).toBe(0);
  });

  test("per-section prefix carry joins only when contiguous", () => {
    const s = stateWith(
      { [TODAY]: completeFard(), "2026-07-02": completeFard() },
      { prefixStreaks: withPrefix("fard", "2026-07-01", 40) },
    );
    expect(deriveStats(s, TODAY).streaks.fard).toBe(42);
  });

  test("ignores a non-contiguous prefix", () => {
    const s = stateWith(
      { [TODAY]: completeFard() },
      { prefixStreaks: withPrefix("fard", "2026-06-20", 40) },
    );
    expect(deriveStats(s, TODAY).streaks.fard).toBe(1);
  });
});

describe("deriveStats — series and totals", () => {
  const positiveDay = (): DayLog => dayWith([{ kind: "fard", prayer: "fajr", state: "masjid" }]);

  test("last7 zero-fills missing days, oldest → newest, today last", () => {
    const s = stateWith({ [TODAY]: positiveDay(), "2026-07-01": positiveDay() });
    const { last7 } = deriveStats(s, TODAY);
    expect(last7).toHaveLength(7);
    expect(last7[0].dayKey).toBe("2026-06-27");
    expect(last7[6]).toEqual({ dayKey: TODAY, score: 3 });
    expect(last7[4]).toEqual({ dayKey: "2026-07-01", score: 3 });
    expect(last7[5]).toEqual({ dayKey: "2026-07-02", score: 0 });
  });

  test("last30 spans 30 days, oldest → newest, today last", () => {
    const s = stateWith({ [TODAY]: positiveDay() });
    const { last30 } = deriveStats(s, TODAY);
    expect(last30).toHaveLength(30);
    expect(last30[0].dayKey).toBe("2026-06-04");
    expect(last30[29]).toEqual({ dayKey: TODAY, score: 3 });
  });

  test("monthly merges a month split across the fold and retained days, oldest → newest", () => {
    const s = stateWith(
      { [TODAY]: positiveDay(), "2026-07-01": positiveDay() }, // July retained: 6 pts
      {
        months: {
          "2026-06": { daysLogged: 30, totalPoints: 100, perfectDays: 0, bestDayScore: 20, masjid: 0, home: 0, missed: 0, rawatib: 0, adhkar: 0, duha: 0, qiyam: 0 },
          "2026-07": { daysLogged: 2, totalPoints: 10, perfectDays: 0, bestDayScore: 8, masjid: 0, home: 0, missed: 0, rawatib: 0, adhkar: 0, duha: 0, qiyam: 0 },
        },
      },
    );
    const { monthly } = deriveStats(s, TODAY);
    expect(monthly.map((m) => m.monthKey)).toEqual(["2026-06", "2026-07"]);
    // July fold (10) + two retained July days (3 + 3) = 16.
    expect(monthly[1]).toEqual({ monthKey: "2026-07", points: 16, daysLogged: 4 });
  });

  test("monthly keeps only the 12 most-recent months", () => {
    const months: WorshipState["months"] = {};
    for (let i = 1; i <= 14; i++) {
      const mk = `2025-${String(i).padStart(2, "0")}`;
      if (i <= 12) months[mk] = { daysLogged: 1, totalPoints: i, perfectDays: 0, bestDayScore: i, masjid: 0, home: 0, missed: 0, rawatib: 0, adhkar: 0, duha: 0, qiyam: 0 };
    }
    // 12 months 2025-01..2025-12
    const { monthly } = deriveStats(stateWith({}, { months }), TODAY);
    expect(monthly).toHaveLength(12);
    expect(monthly[0].monthKey).toBe("2025-01");
    expect(monthly[11].monthKey).toBe("2025-12");
  });

  test("bestDay and totals merge month folds with retained days", () => {
    const s = stateWith(
      { [TODAY]: positiveDay() }, // 3 pts, 1 masjid
      {
        months: {
          "2026-04": {
            daysLogged: 30,
            totalPoints: 200,
            perfectDays: 2,
            bestDayScore: 29,
            masjid: 60,
            home: 40,
            missed: 5,
            rawatib: 50,
            adhkar: 55,
            duha: 20,
            qiyam: 10,
          },
        },
      },
    );
    const stats = deriveStats(s, TODAY);
    expect(stats.bestDayScore).toBe(29);
    expect(stats.bestDayKey).toBeNull(); // best lives in a fold
    expect(stats.totals.points).toBe(203);
    expect(stats.totals.daysLogged).toBe(31);
    expect(stats.totals.perfectDays).toBe(2);
    expect(stats.totals.masjid).toBe(61);
  });

  test("bestDayKey points at a retained day when it holds the record", () => {
    const big = dayWith([
      { kind: "fard", prayer: "fajr", state: "masjid" },
      { kind: "fard", prayer: "dhuhr", state: "masjid" },
      { kind: "fard", prayer: "asr", state: "masjid" },
    ]);
    const s = stateWith({ [TODAY]: positiveDay(), "2026-07-01": big });
    const stats = deriveStats(s, TODAY);
    expect(stats.bestDayScore).toBe(9);
    expect(stats.bestDayKey).toBe("2026-07-01");
  });
});
