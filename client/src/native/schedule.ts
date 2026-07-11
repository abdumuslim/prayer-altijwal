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

  for (let d = 0; d < HORIZON_DAYS; d++) {
    const dateStr = dateKeyIn(now + d * DAY_MS, tz);
    const anchors = anchorsForDay(input, dateStr);

    for (const rule of input.rules) {
      const lead = leadFor(rule);
      const deltaMs = -lead * 60_000; // before → earlier, after → later
      for (const target of rule.prayers) {
        const anchor = anchors[target];
        if (anchor == null) continue;
        const at = anchor + deltaMs;
        if (at <= now || at > horizon) continue;
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
  return out;
}

export { FARD };
