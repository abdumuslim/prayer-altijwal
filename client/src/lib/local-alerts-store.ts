// Single source of truth for the native app's device-local reminder rules.
//
// Previously each component called useLocalAlerts() with its own useState, so
// the rule editor (NativeReminders) and the alarm scheduler (App) held two
// DISCONNECTED copies backed only by the same localStorage — a rule added in
// Settings never reached the running scheduler, so no OS alarm was ever armed
// until a full app restart re-read storage (docs/NATIVE_ALARM_FIXES_SPEC.md §2a).
//
// This module lifts the rules into one external store consumed via
// useSyncExternalStore, so every reader sees the same snapshot and the scheduler
// re-arms the moment the editor mutates a rule. The pure, persisting helpers in
// local-alerts.ts are reused verbatim (they already save + return new lists).

import {
  addLocalAlert,
  loadLocalAlerts,
  removeLocalAlert,
  updateLocalAlert,
  type LocalAlertRule,
} from "./local-alerts";

// The live snapshot. Its reference is STABLE between mutations — required so
// useSyncExternalStore's getSnapshot doesn't loop ("getSnapshot should be
// cached"). It is only ever reassigned inside a mutator below.
let rules: LocalAlertRule[] = loadLocalAlerts();

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeLocalAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocalAlerts(): LocalAlertRule[] {
  return rules;
}

export function addRule(input: Omit<LocalAlertRule, "id">): void {
  rules = addLocalAlert(rules, input);
  emit();
}

export function updateRule(id: number, input: Omit<LocalAlertRule, "id">): void {
  rules = updateLocalAlert(rules, id, input);
  emit();
}

export function removeRule(id: number): void {
  rules = removeLocalAlert(rules, id);
  emit();
}

const SEED_KEY = "prayer.alerts.seeded.v1";

/**
 * Seed one sensible default rule (5 fard, 10 min before, quiet notification —
 * mirrors the web default) the FIRST launch only. Idempotent: the marker key is
 * set unconditionally so a user who deliberately deletes every rule is not
 * re-seeded on the next launch. Safe to call on every native boot.
 */
export function seedDefaultLocalAlerts(): void {
  try {
    if (localStorage.getItem(SEED_KEY)) return;
    localStorage.setItem(SEED_KEY, "1");
  } catch {
    // storage disabled — skip seeding rather than seed on every launch
    return;
  }
  if (rules.length === 0) {
    addRule({
      timing: "before",
      minutes: 10,
      prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
      kind: "notification",
    });
  }
}
