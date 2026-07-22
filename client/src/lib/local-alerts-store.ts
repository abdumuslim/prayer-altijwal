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
import type { AlertTarget } from "@/types/api";

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

// Historical marker of the removed seeder (below). Devices that ran an older
// build carry it; its presence is how the cleanup migration recognizes an
// install that was actually seeded.
const SEED_KEY = "prayer.alerts.seeded.v1";
const MIGRATION_KEY = "prayer.alerts.default-removed.v1";

const FARD: AlertTarget[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/**
 * True only for a rule that is still EXACTLY the old seeded default — 5 fard,
 * 10 min before, quiet notification, and id 1 (the seeder only ever ran on an
 * empty list, so its rule always got id 1). Prayer order is ignored because the
 * editor rewrites it. Anything else means the user touched it: keep it.
 */
function isUntouchedSeededDefault(rule: LocalAlertRule): boolean {
  return (
    rule.id === 1 &&
    rule.timing === "before" &&
    rule.minutes === 10 &&
    rule.kind === "notification" &&
    rule.prayers.length === FARD.length &&
    FARD.every((p) => rule.prayers.includes(p))
  );
}

/**
 * One-time cleanup of the 10-min default rule this app used to seed on first
 * launch (user request, 2026-07-22: no rule should exist until the user creates
 * one). Runs once per device — a fresh install has no seed marker and no rule,
 * so this is a no-op there; a user who edited the default keeps it.
 */
export function migrateRemoveSeededDefault(): void {
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return;
    localStorage.setItem(MIGRATION_KEY, "1");
    if (!localStorage.getItem(SEED_KEY)) return; // never seeded — nothing to undo
  } catch {
    // storage disabled — skip rather than re-run the deletion every launch
    return;
  }
  const seeded = rules.find(isUntouchedSeededDefault);
  if (seeded) removeRule(seeded.id);
}
