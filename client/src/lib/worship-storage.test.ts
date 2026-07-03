import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  coerceDayLog,
  compact,
  loadWorshipState,
  migrate,
  saveWorshipState,
} from "./worship-storage";
import { deriveStats } from "./worship-stats";
import {
  DEFAULT_WORSHIP_STATE,
  applyMark,
  emptyDayLog,
  type DayLog,
  type WorshipMark,
  type WorshipState,
} from "./worship-log";

const TZ = "Asia/Baghdad";
const TODAY = "2026-07-03"; // horizon = today − 62 = 2026-05-02

const dayWith = (marks: WorshipMark[]): DayLog =>
  marks.reduce((acc, m) => applyMark(acc, m), emptyDayLog(TZ));
const masjidDay = (): DayLog => dayWith([{ kind: "fard", prayer: "fajr", state: "masjid" }]);
const missedDay = (): DayLog => dayWith([{ kind: "fard", prayer: "dhuhr", state: "missed" }]);

/* ── in-memory localStorage stub ────────────────────────────────────────── */

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── migrate / coerce ───────────────────────────────────────────────────── */

describe("migrate", () => {
  test("never throws on garbage and yields valid defaults", () => {
    for (const junk of [null, 42, "nope", [], { v: 99 }, { days: "x" }]) {
      const state = migrate(junk);
      expect(state.v).toBe(1);
      expect(state.days).toEqual({});
      expect(state.months).toEqual({});
    }
  });

  test("keeps valid entries and drops hopeless ones", () => {
    const state = migrate({
      v: 1,
      days: { "2026-07-01": masjidDay(), "2026-07-02": "garbage" },
      months: { "2026-04": { daysLogged: "x" } },
      prefixStreak: { end: "2026-05-01", length: 3 },
      dhikrProgress: { morning: { dayKey: "2026-07-01", counts: [3, 1] } },
    });
    expect(state.days["2026-07-01"].fard.fajr).toBe("masjid");
    expect(state.days["2026-07-02"]).toBeUndefined();
    expect(state.months["2026-04"]).toBeUndefined();
    expect(state.prefixStreak).toEqual({ end: "2026-05-01", length: 3 });
    expect(state.dhikrProgress.morning).toEqual({ dayKey: "2026-07-01", counts: [3, 1] });
  });
});

describe("coerceDayLog", () => {
  test("salvages valid fields and defaults junk fard states to unmarked", () => {
    const log = coerceDayLog({
      fard: { fajr: "masjid", dhuhr: "SOMETHING", asr: 5 },
      rawatib: { beforeFajr: true, beforeDhuhr: "yes" },
      adhkar: { morning: true },
      duha: 1,
      qiyam: true,
      tz: TZ,
    });
    expect(log).not.toBeNull();
    expect(log!.fard.fajr).toBe("masjid");
    expect(log!.fard.dhuhr).toBe("unmarked");
    expect(log!.fard.asr).toBe("unmarked");
    expect(log!.rawatib.beforeFajr).toBe(true);
    expect(log!.rawatib.beforeDhuhr).toBe(false);
    expect(log!.adhkar.morning).toBe(true);
    expect(log!.duha).toBe(false); // 1 is not boolean true
    expect(log!.qiyam).toBe(true);
  });

  test("returns null for non-objects", () => {
    expect(coerceDayLog("x")).toBeNull();
    expect(coerceDayLog(null)).toBeNull();
  });
});

/* ── save / load round-trip ─────────────────────────────────────────────── */

describe("save → load", () => {
  test("round-trips the envelope through (stubbed) localStorage", () => {
    const state: WorshipState = {
      ...DEFAULT_WORSHIP_STATE,
      days: { [TODAY]: masjidDay() },
      prefixStreak: { end: "2026-05-01", length: 7 },
    };
    saveWorshipState(state);
    const loaded = loadWorshipState();
    expect(loaded).toEqual(state);
  });

  test("returns defaults when storage is empty or corrupt", () => {
    expect(loadWorshipState()).toEqual(DEFAULT_WORSHIP_STATE);
    localStorage.setItem("prayer.worship.v1", "{not json");
    expect(loadWorshipState()).toEqual(DEFAULT_WORSHIP_STATE);
  });
});

/* ── compact ────────────────────────────────────────────────────────────── */

describe("compact", () => {
  const oldDays: Record<string, DayLog> = {
    "2026-04-28": masjidDay(), // +3
    "2026-04-29": masjidDay(), // +3 (contiguous run of 2)
    "2026-04-30": missedDay(), // −1 (breaks the run)
    "2026-05-01": masjidDay(), // +3 (run of 1 ending at the fold edge)
  };
  const retained: Record<string, DayLog> = {
    "2026-06-01": masjidDay(),
    [TODAY]: masjidDay(),
  };

  const makeState = (): WorshipState => ({
    ...DEFAULT_WORSHIP_STATE,
    days: { ...oldDays, ...retained },
    dhikrProgress: {
      morning: { dayKey: TODAY, counts: [3] },
      evening: { dayKey: "2026-07-01", counts: [1] }, // stale
    },
  });

  test("folds days past the horizon into month aggregates and drops them", () => {
    const out = compact(makeState(), TODAY);
    expect(Object.keys(out.days).sort()).toEqual(["2026-06-01", TODAY]);
    expect(out.months["2026-04"]).toMatchObject({
      daysLogged: 3,
      totalPoints: 5, // 3+3−1
      masjid: 2,
      missed: 1,
      bestDayScore: 3,
    });
    expect(out.months["2026-05"]).toMatchObject({ daysLogged: 1, totalPoints: 3 });
  });

  test("is lossless for derived totals and best-day", () => {
    const before = deriveStats(makeState(), TODAY);
    const after = deriveStats(compact(makeState(), TODAY), TODAY);
    expect(after.totals).toEqual(before.totals);
    expect(after.bestDayScore).toBe(before.bestDayScore);
    expect(after.todayScore).toBe(before.todayScore);
  });

  test("prefixStreak restarts on non-positive days and extends when contiguous", () => {
    const out = compact(makeState(), TODAY);
    // 04-28(+),04-29(+) → run 2; 04-30(−) → 0; 05-01(+) contiguous → run 1.
    expect(out.prefixStreak).toEqual({ end: "2026-05-01", length: 1 });
  });

  test("merges into pre-existing month aggregates", () => {
    const seeded: WorshipState = {
      ...makeState(),
      months: {
        "2026-04": {
          daysLogged: 10,
          totalPoints: 50,
          perfectDays: 1,
          bestDayScore: 20,
          masjid: 30,
          home: 5,
          missed: 2,
          rawatib: 9,
          adhkar: 8,
          duha: 7,
          qiyam: 6,
        },
      },
    };
    const out = compact(seeded, TODAY);
    expect(out.months["2026-04"]).toMatchObject({
      daysLogged: 13,
      totalPoints: 55,
      masjid: 32,
      missed: 3,
      bestDayScore: 20,
    });
  });

  test("is idempotent and immutable", () => {
    const state = makeState();
    const once = compact(state, TODAY);
    const twice = compact(once, TODAY);
    expect(twice).toEqual(once);
    expect(state.days["2026-04-28"]).toBeDefined(); // input untouched
  });

  test("drops dhikr progress from previous days, keeps today's", () => {
    const out = compact(makeState(), TODAY);
    expect(out.dhikrProgress.morning).toEqual({ dayKey: TODAY, counts: [3] });
    expect(out.dhikrProgress.evening).toBeUndefined();
  });
});
