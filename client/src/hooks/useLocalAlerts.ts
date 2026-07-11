// Device-local reminder rules for the native app. Thin wrapper over the shared
// external store in lib/local-alerts-store.ts so the rule editor and the alarm
// scheduler read ONE snapshot (docs/NATIVE_ALARM_FIXES_SPEC.md §2a). The public
// UseLocalAlerts shape is unchanged, so consumers need no edits.

import { useSyncExternalStore } from "react";
import {
  addRule,
  getLocalAlerts,
  removeRule,
  subscribeLocalAlerts,
  updateRule,
} from "@/lib/local-alerts-store";
import type { LocalAlertRule } from "@/lib/local-alerts";

export interface UseLocalAlerts {
  rules: LocalAlertRule[];
  add: (input: Omit<LocalAlertRule, "id">) => void;
  update: (id: number, input: Omit<LocalAlertRule, "id">) => void;
  remove: (id: number) => void;
}

export function useLocalAlerts(): UseLocalAlerts {
  const rules = useSyncExternalStore(subscribeLocalAlerts, getLocalAlerts);
  // add/update/remove are module-level functions → referentially stable.
  return { rules, add: addRule, update: updateRule, remove: removeRule };
}
