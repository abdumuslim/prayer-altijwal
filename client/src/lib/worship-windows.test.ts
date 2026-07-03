import { describe, expect, test } from "vitest";
import { canMark, isEditableDay, parentPrayerOf } from "./worship-windows";
import type { WorshipMark } from "./worship-log";
import type { PrayerName } from "@/types/api";

// Baghdad-like day: fajr 03:35, dhuhr 12:11, asr 15:47, maghrib 19:16, isha 20:46 (UTC ms).
const T = (h: number, m: number) => Date.UTC(2026, 6, 3, h - 3, m); // +03 offset
const PRAYERS: { name: PrayerName; timestamp: number | null }[] = [
  { name: "fajr", timestamp: T(3, 35) },
  { name: "sunrise", timestamp: T(5, 6) },
  { name: "dhuhr", timestamp: T(12, 11) },
  { name: "asr", timestamp: T(15, 47) },
  { name: "maghrib", timestamp: T(19, 16) },
  { name: "isha", timestamp: T(20, 46) },
];

const fard = (state = "masjid" as const): WorshipMark => ({ kind: "fard", prayer: "asr", state });

describe("parentPrayerOf", () => {
  test("maps every mark to its gating prayer", () => {
    expect(parentPrayerOf({ kind: "fard", prayer: "maghrib", state: "home" })).toBe("maghrib");
    expect(parentPrayerOf({ kind: "rawatib", slot: "beforeFajr", done: true })).toBe("fajr");
    expect(parentPrayerOf({ kind: "rawatib", slot: "beforeDhuhr", done: true })).toBe("dhuhr");
    expect(parentPrayerOf({ kind: "rawatib", slot: "afterMaghrib", done: true })).toBe("maghrib");
    expect(parentPrayerOf({ kind: "adhkar", slot: "afterIsha", done: true })).toBe("isha");
    expect(parentPrayerOf({ kind: "adhkar", slot: "morning", done: true })).toBe("fajr");
    expect(parentPrayerOf({ kind: "adhkar", slot: "evening", done: true })).toBe("asr");
    expect(parentPrayerOf({ kind: "duha", done: true })).toBeNull();
    expect(parentPrayerOf({ kind: "qiyam", done: true })).toBeNull();
  });
});

describe("canMark", () => {
  test("a fard is unmarkable before its adhan and markable after", () => {
    expect(canMark(fard(), PRAYERS, T(15, 46))).toBe(false);
    expect(canMark(fard(), PRAYERS, T(15, 47))).toBe(true);
    expect(canMark(fard(), PRAYERS, T(23, 0))).toBe(true);
  });

  test("rawatib and adhkar gate on their parent adhan", () => {
    const beforeDhuhr: WorshipMark = { kind: "rawatib", slot: "beforeDhuhr", done: true };
    expect(canMark(beforeDhuhr, PRAYERS, T(11, 0))).toBe(false);
    expect(canMark(beforeDhuhr, PRAYERS, T(12, 11))).toBe(true);

    const evening: WorshipMark = { kind: "adhkar", slot: "evening", done: true };
    expect(canMark(evening, PRAYERS, T(15, 0))).toBe(false);
    expect(canMark(evening, PRAYERS, T(16, 0))).toBe(true);
  });

  test("duha and qiyam are self-reported and always markable", () => {
    expect(canMark({ kind: "duha", done: true }, PRAYERS, T(0, 1))).toBe(true);
    expect(canMark({ kind: "qiyam", done: true }, PRAYERS, T(0, 1))).toBe(true);
  });

  test("a null parent timestamp degrades to markable (high-latitude fallback)", () => {
    const noIsha = PRAYERS.map((p) => (p.name === "isha" ? { ...p, timestamp: null } : p));
    expect(canMark({ kind: "fard", prayer: "isha", state: "home" }, noIsha, T(1, 0))).toBe(true);
  });

  test("a missing prayer row also degrades to markable", () => {
    expect(canMark(fard(), [], T(0, 1))).toBe(true);
  });
});

describe("isEditableDay", () => {
  test("true only for the current civil day in the location tz", () => {
    const now = T(23, 30); // 23:30 Baghdad = 20:30 UTC on 2026-07-03
    expect(isEditableDay("2026-07-03", "Asia/Baghdad", now)).toBe(true);
    expect(isEditableDay("2026-07-02", "Asia/Baghdad", now)).toBe(false);
    // A minute past Baghdad midnight the same UTC evening: day locks.
    const pastMidnight = Date.UTC(2026, 6, 3, 21, 1); // 00:01 on 07-04 in Baghdad
    expect(isEditableDay("2026-07-03", "Asia/Baghdad", pastMidnight)).toBe(false);
    expect(isEditableDay("2026-07-04", "Asia/Baghdad", pastMidnight)).toBe(true);
  });
});
