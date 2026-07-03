import { describe, expect, test } from "vitest";
import {
  ADHKAR_SLOTS,
  FARD_PRAYERS,
  PERFECT_DAY_SCORE,
  RAWATIB_SLOTS,
  applyMark,
  emptyDayLog,
  isPerfectDay,
  scoreDay,
  type DayLog,
  type WorshipMark,
} from "./worship-log";

const deepFreeze = <T,>(obj: T): T => {
  for (const v of Object.values(obj as object)) {
    if (typeof v === "object" && v !== null) deepFreeze(v);
  }
  return Object.freeze(obj);
};

const applyAll = (log: DayLog, marks: WorshipMark[]): DayLog =>
  marks.reduce((acc, m) => applyMark(acc, m), log);

const perfectDay = (): DayLog =>
  applyAll(emptyDayLog("Asia/Baghdad"), [
    ...FARD_PRAYERS.map((p): WorshipMark => ({ kind: "fard", prayer: p, state: "masjid" })),
    ...RAWATIB_SLOTS.map((s): WorshipMark => ({ kind: "rawatib", slot: s, done: true })),
    ...ADHKAR_SLOTS.map((s): WorshipMark => ({ kind: "adhkar", slot: s, done: true })),
    { kind: "duha", done: true },
    { kind: "qiyam", done: true },
  ]);

describe("scoreDay", () => {
  test("an untouched day scores 0", () => {
    expect(scoreDay(emptyDayLog("Asia/Baghdad"))).toBe(0);
  });

  test("a perfect day scores exactly PERFECT_DAY_SCORE (29)", () => {
    const day = perfectDay();
    expect(scoreDay(day)).toBe(PERFECT_DAY_SCORE);
    expect(isPerfectDay(day)).toBe(true);
  });

  test("all prayers missed and nothing else scores −5", () => {
    const day = applyAll(
      emptyDayLog("Asia/Baghdad"),
      FARD_PRAYERS.map((p): WorshipMark => ({ kind: "fard", prayer: p, state: "missed" })),
    );
    expect(scoreDay(day)).toBe(-5);
    expect(isPerfectDay(day)).toBe(false);
  });

  test("mixed day adds fard points and +1 bonuses", () => {
    // masjid(3) + home(2) + rawatib(1) + adhkar(1) + duha(1) = 8
    const day = applyAll(emptyDayLog("Asia/Baghdad"), [
      { kind: "fard", prayer: "fajr", state: "masjid" },
      { kind: "fard", prayer: "dhuhr", state: "home" },
      { kind: "rawatib", slot: "beforeFajr", done: true },
      { kind: "adhkar", slot: "morning", done: true },
      { kind: "duha", done: true },
    ]);
    expect(scoreDay(day)).toBe(8);
  });
});

describe("applyMark", () => {
  test("returns a new object and never mutates the (frozen) input", () => {
    const original = deepFreeze(emptyDayLog("Asia/Baghdad"));
    const next = applyMark(original, { kind: "fard", prayer: "asr", state: "masjid" });
    expect(next).not.toBe(original);
    expect(next.fard.asr).toBe("masjid");
    expect(original.fard.asr).toBe("unmarked");
  });

  test("a fard state can transition back to unmarked (undo)", () => {
    const marked = applyMark(emptyDayLog("Asia/Baghdad"), { kind: "fard", prayer: "isha", state: "home" });
    const undone = applyMark(marked, { kind: "fard", prayer: "isha", state: "unmarked" });
    expect(undone.fard.isha).toBe("unmarked");
    expect(scoreDay(undone)).toBe(0);
  });

  test("rawatib and adhkar toggles set and clear", () => {
    const on = applyMark(emptyDayLog("Asia/Baghdad"), { kind: "rawatib", slot: "afterIsha", done: true });
    expect(on.rawatib.afterIsha).toBe(true);
    const off = applyMark(on, { kind: "rawatib", slot: "afterIsha", done: false });
    expect(off.rawatib.afterIsha).toBe(false);
  });

  test("duha and qiyam marks set their flags independently", () => {
    const day = applyAll(emptyDayLog("Asia/Baghdad"), [
      { kind: "duha", done: true },
      { kind: "qiyam", done: true },
    ]);
    expect(day.duha).toBe(true);
    expect(day.qiyam).toBe(true);
    expect(scoreDay(day)).toBe(2);
  });
});
