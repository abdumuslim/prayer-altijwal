import { describe, expect, test } from "vitest";
import { dayContribution, deriveStats } from "./worship-stats";
import {
  DEFAULT_WORSHIP_STATE,
  applyMark,
  emptyDayLog,
  type DayLog,
  type WorshipMark,
  type WorshipState,
} from "./worship-log";

const TZ = "Asia/Baghdad";
const TODAY = "2026-07-03";

const dayWith = (marks: WorshipMark[]): DayLog =>
  marks.reduce((acc, m) => applyMark(acc, m), emptyDayLog(TZ));

/** A simple positive day: fajr in masjid (+3). */
const positiveDay = (): DayLog => dayWith([{ kind: "fard", prayer: "fajr", state: "masjid" }]);
/** A negative day: one missed prayer, nothing else (−1). */
const negativeDay = (): DayLog => dayWith([{ kind: "fard", prayer: "dhuhr", state: "missed" }]);

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

describe("deriveStats — streak", () => {
  test("includes today when today is already positive", () => {
    const s = stateWith({
      [TODAY]: positiveDay(),
      "2026-07-02": positiveDay(),
      "2026-07-01": positiveDay(),
    });
    expect(deriveStats(s, TODAY).streak).toBe(3);
  });

  test("anchors at yesterday while today is still zero", () => {
    const s = stateWith({
      "2026-07-02": positiveDay(),
      "2026-07-01": positiveDay(),
    });
    const stats = deriveStats(s, TODAY);
    expect(stats.todayScore).toBe(0);
    expect(stats.streak).toBe(2);
  });

  test("is broken by a missing day", () => {
    const s = stateWith({
      [TODAY]: positiveDay(),
      // 07-02 absent
      "2026-07-01": positiveDay(),
    });
    expect(deriveStats(s, TODAY).streak).toBe(1);
  });

  test("is broken by a negative day", () => {
    const s = stateWith({
      [TODAY]: positiveDay(),
      "2026-07-02": negativeDay(),
      "2026-07-01": positiveDay(),
    });
    expect(deriveStats(s, TODAY).streak).toBe(1);
  });

  test("continues through the compaction horizon via prefixStreak", () => {
    const s = stateWith(
      { [TODAY]: positiveDay(), "2026-07-02": positiveDay() },
      { prefixStreak: { end: "2026-07-01", length: 40 } },
    );
    expect(deriveStats(s, TODAY).streak).toBe(42);
  });

  test("ignores a non-contiguous prefixStreak", () => {
    const s = stateWith(
      { [TODAY]: positiveDay() },
      { prefixStreak: { end: "2026-06-20", length: 40 } },
    );
    expect(deriveStats(s, TODAY).streak).toBe(1);
  });
});

describe("deriveStats — series and totals", () => {
  test("last7 zero-fills missing days, oldest → newest, today last", () => {
    const s = stateWith({ [TODAY]: positiveDay(), "2026-07-01": positiveDay() });
    const { last7 } = deriveStats(s, TODAY);
    expect(last7).toHaveLength(7);
    expect(last7[0].dayKey).toBe("2026-06-27");
    expect(last7[6]).toEqual({ dayKey: TODAY, score: 3 });
    expect(last7[4]).toEqual({ dayKey: "2026-07-01", score: 3 });
    expect(last7[5]).toEqual({ dayKey: "2026-07-02", score: 0 });
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
