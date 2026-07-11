// Unit tests for the on-device alarm scheduler (native/schedule.ts): correct
// fire instants (incl. before/after offsets), horizon bounds, per-rule ids, tone
// only on alarm kind, and localized text reuse.

import { describe, it, expect } from "vitest";
import { computeSchedule, type ScheduleInput } from "./schedule";
import type { LocalAlertRule } from "@/lib/local-alerts";
import type { StoredLocation } from "@/lib/storage";

const BAGHDAD: StoredLocation = {
  city: "Baghdad",
  cityAr: "بغداد",
  country: "IQ",
  tz: "Asia/Baghdad",
  lat: 33.34058,
  lon: 44.40088,
  elevation: 41,
};

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
});
