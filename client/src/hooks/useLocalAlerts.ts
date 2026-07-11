// Device-local reminder rules for the native app (localStorage-backed). Mirrors
// the shape of usePrayerAlerts but with no server/endpoint — the on-device
// scheduler (useNativeAlarmScheduler) turns these into OS alarms.

import { useCallback, useState } from "react";
import {
  addLocalAlert,
  loadLocalAlerts,
  removeLocalAlert,
  updateLocalAlert,
  type LocalAlertRule,
} from "@/lib/local-alerts";

export interface UseLocalAlerts {
  rules: LocalAlertRule[];
  add: (input: Omit<LocalAlertRule, "id">) => void;
  update: (id: number, input: Omit<LocalAlertRule, "id">) => void;
  remove: (id: number) => void;
}

export function useLocalAlerts(): UseLocalAlerts {
  const [rules, setRules] = useState<LocalAlertRule[]>(() => loadLocalAlerts());

  const add = useCallback((input: Omit<LocalAlertRule, "id">) => {
    setRules((r) => addLocalAlert(r, input));
  }, []);

  const update = useCallback((id: number, input: Omit<LocalAlertRule, "id">) => {
    setRules((r) => updateLocalAlert(r, id, input));
  }, []);

  const remove = useCallback((id: number) => {
    setRules((r) => removeLocalAlert(r, id));
  }, []);

  return { rules, add, update, remove };
}
