// Unit tests for the on-device alarm scheduler (native/schedule.ts): correct
// fire instants (incl. before/after offsets), horizon bounds, per-rule ids, tone
// only on alarm kind, and localized text reuse.

import { describe, it, expect } from "vitest";
import { computeSchedule, type ScheduleInput } from "./schedule";
import type { ScheduledAlarm } from "@/lib/native";
import type { LocalAlertRule } from "@/lib/local-alerts";
import type { StoredLocation } from "@/lib/storage";
import type { Lang } from "@/types/api";

const BAGHDAD: StoredLocation = {
  city: "Baghdad",
  cityAr: "بغداد",
  country: "IQ",
  tz: "Asia/Baghdad",
  lat: 33.34058,
  lon: 44.40088,
  elevation: 41,
};

// A DST timezone (US Eastern) — spring-forward 2026-03-08, fall-back 2026-11-01.
const NEW_YORK: StoredLocation = {
  city: "New York",
  cityAr: "نيويورك",
  country: "US",
  tz: "America/New_York",
  lat: 40.7128,
  lon: -74.006,
  elevation: 10,
};

// High latitude (69.65°N) — some summer prayers are twilight-derived / absent.
const TROMSO: StoredLocation = {
  city: "Tromsø",
  cityAr: "ترومسو",
  country: "NO",
  tz: "Europe/Oslo",
  lat: 69.6492,
  lon: 18.9553,
  elevation: 10,
};

const ALL_FARD: LocalAlertRule = {
  id: 1,
  timing: "at_time",
  minutes: null,
  prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
  kind: "alarm",
};

/** Build a ScheduleInput for an arbitrary location/clock (defaults to English). */
function inputFor(
  location: StoredLocation,
  rules: LocalAlertRule[],
  now: Date,
  lang: Lang = "en",
): ScheduleInput {
  return { location, lang, methodAuto: true, toneId: "soft-plucks", rules, now };
}

/** The civil date key one day after `key` (test mirror of schedule.ts). */
function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// Fixed clock: 2026-06-19 00:00 Baghdad — the whole digitized day is ahead.
const NOW = new Date("2026-06-19T00:00:00+03:00");

function baseInput(rules: LocalAlertRule[]): ScheduleInput {
  return {
    location: BAGHDAD,
    lang: "ar",
    methodAuto: true,
    toneId: "soft-plucks",
    rules,
    now: NOW,
  };
}

/** Minute-of-day (Baghdad) for an epoch ms. */
function baghdadMinute(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hh % 24) * 60 + mm;
}

describe("computeSchedule", () => {
  it("schedules an at-time alarm for each fard at the poster time", () => {
    const rule: LocalAlertRule = {
      id: 1,
      timing: "at_time",
      minutes: null,
      prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
      kind: "alarm",
    };
    const alarms = computeSchedule(baseInput([rule]));
    // Today (2026-06-19) is digitized → exact poster times.
    const today = alarms.filter((a) => a.id.startsWith("2026-06-19-"));
    const fajr = today.find((a) => a.target === "fajr");
    expect(fajr).toBeTruthy();
    expect(baghdadMinute(fajr!.at)).toBe(3 * 60 + 10); // 03:10 poster
    expect(fajr!.kind).toBe("alarm");
    expect(fajr!.toneId).toBe("soft-plucks");
    // All five fard scheduled today.
    expect(new Set(today.map((a) => a.target))).toEqual(
      new Set(["fajr", "dhuhr", "asr", "maghrib", "isha"]),
    );
  });

  it("applies before/after offsets to the anchor", () => {
    const before: LocalAlertRule = { id: 2, timing: "before", minutes: 15, prayers: ["dhuhr"], kind: "notification" };
    const after: LocalAlertRule = { id: 3, timing: "after", minutes: 20, prayers: ["dhuhr"], kind: "notification" };
    const alarms = computeSchedule(baseInput([before, after]));
    const b = alarms.find((a) => a.id === "2026-06-19-r2-dhuhr");
    const a = alarms.find((a) => a.id === "2026-06-19-r3-dhuhr");
    // Dhuhr poster 12:09 → before-15 = 11:54, after-20 = 12:29.
    expect(baghdadMinute(b!.at)).toBe(11 * 60 + 54);
    expect(baghdadMinute(a!.at)).toBe(12 * 60 + 29);
    // Notification kind carries no tone.
    expect(b!.toneId).toBe("");
    // The anchor (adhan) instant rides along for the ring-screen countdown:
    // before → anchor is 15 min AFTER the fire; after → 20 min BEFORE it.
    expect(b!.anchorAt - b!.at).toBe(15 * 60_000);
    expect(a!.anchorAt - a!.at).toBe(-20 * 60_000);
    expect(b!.untilLabel).toBe("المتبقي للأذان"); // reused hero label (lang=ar)
  });

  it("keeps only future instants within the 7-day horizon", () => {
    const rule: LocalAlertRule = { id: 4, timing: "at_time", minutes: null, prayers: ["fajr"], kind: "alarm" };
    const alarms = computeSchedule(baseInput([rule]));
    expect(alarms.length).toBeGreaterThanOrEqual(6); // ~7 days of fajr
    expect(alarms.length).toBeLessThanOrEqual(8);
    for (const a of alarms) {
      expect(a.at).toBeGreaterThan(NOW.getTime());
      expect(a.at).toBeLessThanOrEqual(NOW.getTime() + 7 * 86_400_000);
    }
  });

  it("localizes the title (Arabic) and marks Friday dhuhr", () => {
    const rule: LocalAlertRule = { id: 5, timing: "at_time", minutes: null, prayers: ["dhuhr"], kind: "notification" };
    const alarms = computeSchedule(baseInput([rule]));
    const fri = alarms.find((a) => {
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Baghdad", weekday: "short" }).format(new Date(a.at));
      return wd === "Fri";
    });
    expect(fri?.title).toBe("الجمعة"); // Friday face of dhuhr
    const nonFri = alarms.find((a) => a.title !== "الجمعة");
    expect(nonFri?.title).toBe("الظهر");
  });

  it("produces no alarms when there are no rules", () => {
    expect(computeSchedule(baseInput([]))).toEqual([]);
  });

  // ── DST-safe civil-day iteration (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3f) ──

  it("covers every civil date once across US spring-forward (2026-03-08)", () => {
    // 23:30 the night before the lost hour: the old `now + d*DAY_MS` math shifted
    // +1h past the transition and skipped 2026-03-08 entirely.
    const now = new Date("2026-03-07T23:30:00-05:00");
    const alarms = computeSchedule(inputFor(NEW_YORK, [ALL_FARD], now));
    const dates = alarms.map((a) => a.id.slice(0, 10));
    // No duplicate ids.
    expect(new Set(alarms.map((a) => a.id)).size).toBe(alarms.length);
    // The spring-forward date itself is not skipped.
    expect(dates).toContain("2026-03-08");
    // The distinct dates form a contiguous run — no gap from the lost hour.
    const distinct = [...new Set(dates)].sort();
    for (let i = 1; i < distinct.length; i++) {
      expect(nextDay(distinct[i - 1])).toBe(distinct[i]);
    }
  });

  it("produces no duplicate ids across US fall-back (2026-11-01)", () => {
    // 00:30 just after midnight before the repeated hour: the old math wrapped a
    // later sample back onto the prior civil date, duplicating its ids.
    const now = new Date("2026-11-01T00:30:00-04:00");
    const alarms = computeSchedule(inputFor(NEW_YORK, [ALL_FARD], now));
    // No id collides — a duplicated civil date would repeat its fireKeys.
    expect(new Set(alarms.map((a) => a.id)).size).toBe(alarms.length);
    // Distinct dates stay a contiguous run (the repeated hour doesn't fold one
    // sample back onto the prior date).
    const distinct = [...new Set(alarms.map((a) => a.id.slice(0, 10)))].sort();
    for (let i = 1; i < distinct.length; i++) {
      expect(nextDay(distinct[i - 1])).toBe(distinct[i]);
    }
  });

  // ── Finite guard (NaN/null anchors dropped, valid days kept) — §3f ──

  it("only emits finite instants across varied timezones", () => {
    const all: LocalAlertRule = {
      id: 1,
      timing: "at_time",
      minutes: null,
      prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha", "duha", "qiyam", "adhkar_morning", "adhkar_evening"],
      kind: "alarm",
    };
    const runs: Array<[StoredLocation, Date]> = [
      [BAGHDAD, new Date("2026-06-19T00:00:00+03:00")],
      [NEW_YORK, new Date("2026-03-07T23:30:00-05:00")],
      [TROMSO, new Date("2026-01-10T00:00:00+01:00")],
    ];
    for (const [loc, now] of runs) {
      const alarms = computeSchedule(inputFor(loc, [all], now));
      for (const a of alarms) {
        expect(Number.isFinite(a.at)).toBe(true);
        expect(Number.isFinite(a.anchorAt)).toBe(true);
      }
    }
  });

  it("returns alarms for valid days at high latitude (Tromsø summer) without throwing", () => {
    // Near the midnight sun some prayers are absent/NaN; the finite guard drops
    // those instants but the day (and the horizon) must still yield alarms.
    const now = new Date("2026-06-15T00:00:00+02:00");
    let alarms: ScheduledAlarm[] = [];
    expect(() => {
      alarms = computeSchedule(inputFor(TROMSO, [ALL_FARD], now));
    }).not.toThrow();
    expect(alarms.length).toBeGreaterThan(0);
    for (const a of alarms) {
      expect(Number.isFinite(a.at)).toBe(true);
      expect(Number.isFinite(a.anchorAt)).toBe(true);
    }
  });

  it("throws when every day fails (systemic failure), not silently returns []", () => {
    // An invalid IANA tz makes the per-day compute throw for every day; a silent
    // [] here would cancel the whole armed set, so computeSchedule must surface it.
    const badTz: StoredLocation = { ...BAGHDAD, tz: "Not/AZone" };
    const rule: LocalAlertRule = {
      id: 1,
      timing: "at_time",
      minutes: null,
      prayers: ["fajr"],
      kind: "alarm",
    };
    expect(() => computeSchedule(inputFor(badTz, [rule], NOW))).toThrow(/computeSchedule/);
    // A legitimately empty horizon (no rules, all days valid) still returns [].
    expect(computeSchedule(baseInput([]))).toEqual([]);
  });
});
