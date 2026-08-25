// Turns the device's local reminder rules into a 7-day list of on-device alarm
// instants (docs/NATIVE_ALARM_SPEC.md §3e). Pure + deterministic (inject `now`
// for tests). Runs in the native-only chunk: it reuses the offline engine
// (computeLocalPrayerTimes) and the SAME server notification text
// (buildPushPayload) so native alarms read identically to web push.

import { computeLocalPrayerTimes } from "./local-times";
import { buildPushPayload } from "../../../server/src/push/notification-text.js";
import { ar } from "@/i18n/strings.ar";
import { en } from "@/i18n/strings.en";
import type { ScheduledAlarm } from "@/lib/native";
import type { LocalAlertRule } from "@/lib/local-alerts";
import type { AlertTarget, AsrMadhab, Lang } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 7;
const FARD: AlertTarget[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

export interface ScheduleInput {
  location: StoredLocation;
  lang: Lang;
  method?: string | null;
  methodAuto: boolean;
  asr?: AsrMadhab | null;
  /** Selected alarm tone id (used for alarm-kind rules). */
  toneId: string;
  rules: LocalAlertRule[];
  /** Injected clock for tests; defaults to new Date(). */
  now?: Date;
}

/** UTC ms of local midnight (00:00) of `dateStr` in `tz`. */
function localMidnightMs(dateStr: string, tz: string): number {
  const noonUtc = Date.parse(`${dateStr}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(noonUtc));
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return noonUtc - ((hh % 24) * 60 + mm) * 60_000;
}

/** Civil date key (YYYY-MM-DD) for an instant in `tz`. */
function dateKeyIn(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/**
 * The civil date key one day after `key` (YYYY-MM-DD), by pure UTC arithmetic.
 * DST-safe: stepping the calendar date (not `now + d*DAY_MS`) visits every civil
 * day exactly once across spring-forward/fall-back (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3f).
 */
function nextDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Type guard: a finite number (excludes null/undefined/NaN/±Infinity). */
function isFiniteMs(x: number | null): x is number {
  return Number.isFinite(x);
}

function isFriday(ms: number, tz: string): boolean {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(ms)) ===
    "Fri"
  );
}

/** The nine schedulable anchors (epoch ms, or null) for one civil day. */
function anchorsForDay(input: ScheduleInput, dateStr: string): Record<AlertTarget, number | null> {
  const tz = input.location.tz;
  const nowMid = new Date(localMidnightMs(dateStr, tz) + 1000);
  const p = computeLocalPrayerTimes({
    location: input.location,
    lang: input.lang,
    method: input.method,
    methodAuto: input.methodAuto,
    asr: input.asr,
    date: dateStr,
    now: nowMid,
  });
  const ts = (name: string): number | null =>
    p.prayers.find((x) => x.name === name)?.timestamp ?? null;
  return {
    fajr: ts("fajr"),
    dhuhr: ts("dhuhr"),
    asr: ts("asr"),
    maghrib: ts("maghrib"),
    isha: ts("isha"),
    duha: p.duhaWindow?.start ?? null,
    qiyam: p.qiyamWindow?.start ?? null,
    adhkar_morning: ts("fajr"),
    adhkar_evening: ts("asr"),
  };
}

/** Signed lead in minutes for buildPushPayload: +N before, −N after, 0 at time. */
function leadFor(rule: LocalAlertRule): number {
  if (rule.timing === "before") return rule.minutes ?? 0;
  if (rule.timing === "after") return -(rule.minutes ?? 0);
  return 0;
}

/**
 * Build the next ~7 days of alarm instants from the device's rules. Only instants
 * strictly in the future and within the horizon are kept; ids match the server
 * fireKey convention (`${dateKey}-r${ruleId}-${target}`).
 */
export function computeSchedule(input: ScheduleInput): ScheduledAlarm[] {
  const tz = input.location.tz;
  const now = (input.now ?? new Date()).getTime();
  const horizon = now + HORIZON_DAYS * DAY_MS;
  // Reused hero label — the ring screen shows a live countdown to the anchor.
  const untilLabel = (input.lang === "ar" ? ar : en)["next.header"];
  const out: ScheduledAlarm[] = [];

  // Day 0 = today in the target tz; later days step the civil calendar (not
  // `now + d*DAY_MS`) so DST transitions neither skip nor duplicate a date. The
  // key is derived inside the try, so a corrupt tz fails every day (surfaced by
  // the okDays guard below) instead of throwing before the loop.
  let dateStr = ""; // "" until the first civil day is derived
  let okDays = 0; // days whose anchors computed; 0 means a systemic failure
  for (let d = 0; d < HORIZON_DAYS; d++) {
    let anchors: Record<AlertTarget, number | null>;
    try {
      dateStr = dateStr === "" ? dateKeyIn(now, tz) : nextDateKey(dateStr);
      anchors = anchorsForDay(input, dateStr);
    } catch {
      // Fault isolation: one bad civil day (engine/tz throw) drops that day only.
      continue;
    }
    okDays++;

    for (const rule of input.rules) {
      const lead = leadFor(rule);
      const deltaMs = -lead * 60_000; // before → earlier, after → later
      for (const target of rule.prayers) {
        const anchor = anchors[target];
        if (!isFiniteMs(anchor)) continue; // null/undefined/NaN all excluded
        const at = anchor + deltaMs;
        if (!Number.isFinite(at) || at <= now || at > horizon) continue;
        const friday = target === "dhuhr" && isFriday(at, tz);
        const { title, body } = buildPushPayload(target, lead, input.lang, { friday });
        out.push({
          id: `${dateStr}-r${rule.id}-${target}`,
          at,
          kind: rule.kind,
          title,
          body,
          toneId: rule.kind === "alarm" ? input.toneId : "",
          target,
          anchorAt: anchor,
          untilLabel,
        });
      }
    }
  }
  // A systemic failure (every day threw, e.g. corrupt persisted method/tz) must
  // surface, not silently return []: an empty result would make the caller cancel
  // every armed alarm and never retry. A legitimately empty horizon (no rules, or
  // valid days with no future instants) keeps okDays > 0 and returns [] normally.
  if (okDays === 0) {
    throw new Error("computeSchedule: every day in the 7-day horizon failed to compute");
  }
  return out;
}

export { FARD };
