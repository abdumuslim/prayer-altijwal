// Device-local reminder rules for the native (Capacitor) app. Web Push doesn't
// exist in the Android WebView, so rules can't key on a push endpoint the way the
// web app's server-side rules do (docs/NATIVE_ALARM_SPEC.md D4). Instead the same
// rule shape (minus `endpoint`) is persisted in localStorage and fed to the
// on-device scheduler. Immutable updates (return a new list; never mutate).

import type { AlertKind, AlertTarget, AlertTiming } from "@/types/api";

const STORAGE_KEY = "prayer.alerts.v1";

/** A local reminder rule (native mirror of a server PrayerAlert, without endpoint). */
export interface LocalAlertRule {
  id: number;
  timing: AlertTiming;
  minutes: number | null;
  prayers: AlertTarget[];
  kind: AlertKind;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

const TIMINGS: AlertTiming[] = ["at_time", "before", "after"];
const KINDS: AlertKind[] = ["notification", "alarm"];
const TARGETS: AlertTarget[] = [
  "fajr",
  "dhuhr",
  "asr",
  "maghrib",
  "isha",
  "duha",
  "qiyam",
  "adhkar_morning",
  "adhkar_evening",
];

/** Coerce an unknown value into a valid rule, or null if unusable. */
function coerceRule(raw: unknown): LocalAlertRule | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "number" ? raw.id : NaN;
  const timing = TIMINGS.includes(raw.timing as AlertTiming) ? (raw.timing as AlertTiming) : null;
  const kind = KINDS.includes(raw.kind as AlertKind) ? (raw.kind as AlertKind) : "notification";
  const prayers = Array.isArray(raw.prayers)
    ? (raw.prayers.filter((p): p is AlertTarget => TARGETS.includes(p as AlertTarget)))
    : [];
  if (!Number.isFinite(id) || !timing || prayers.length === 0) return null;
  const minutes =
    (timing === "before" || timing === "after") &&
    typeof raw.minutes === "number" &&
    raw.minutes >= 1 &&
    raw.minutes <= 180
      ? Math.round(raw.minutes)
      : null;
  return { id, timing, minutes, prayers, kind };
}

export function loadLocalAlerts(): LocalAlertRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(coerceRule).filter((r): r is LocalAlertRule => r !== null);
  } catch {
    return [];
  }
}

export function saveLocalAlerts(rules: LocalAlertRule[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // storage full / disabled — rules stay in memory for this session
  }
}

/** Next id = max existing + 1 (ids are stable, monotonic per device). */
function nextId(rules: LocalAlertRule[]): number {
  return rules.reduce((m, r) => Math.max(m, r.id), 0) + 1;
}

export function addLocalAlert(
  rules: LocalAlertRule[],
  input: Omit<LocalAlertRule, "id">,
): LocalAlertRule[] {
  const next = [...rules, { ...input, id: nextId(rules) }];
  saveLocalAlerts(next);
  return next;
}

export function updateLocalAlert(
  rules: LocalAlertRule[],
  id: number,
  patch: Omit<LocalAlertRule, "id">,
): LocalAlertRule[] {
  const next = rules.map((r) => (r.id === id ? { ...patch, id } : r));
  saveLocalAlerts(next);
  return next;
}

export function removeLocalAlert(rules: LocalAlertRule[], id: number): LocalAlertRule[] {
  const next = rules.filter((r) => r.id !== id);
  saveLocalAlerts(next);
  return next;
}
