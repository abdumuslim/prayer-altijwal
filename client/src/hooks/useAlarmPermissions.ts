// Native alarm permission state + actions (Android). Reads PrayerAlarm.getState()
// and re-checks on every app resume — the OS can revoke the exact-alarm
// permission, which silently drops scheduled alarms, so the onboarding UI must
// reflect the live state. No-op on web (state stays null).

import { useCallback, useEffect, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import { isNative, PrayerAlarm, type PrayerAlarmState } from "@/lib/native";

export interface UseAlarmPermissions {
  state: PrayerAlarmState | null;
  refresh: () => void;
  requestNotifications: () => void;
  openExact: () => void;
  openFullScreen: () => void;
  openBattery: () => void;
}

export function useAlarmPermissions(): UseAlarmPermissions {
  const [state, setState] = useState<PrayerAlarmState | null>(null);

  const refresh = useCallback(() => {
    if (!isNative()) return;
    void PrayerAlarm.getState()
      .then(setState)
      .catch(() => setState(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) refresh();
    }).then((handle) => {
      remove = () => void handle.remove();
    });
    return () => remove?.();
  }, [refresh]);

  const requestNotifications = useCallback(() => {
    if (!isNative()) return;
    void PrayerAlarm.requestNotificationPermission()
      .catch(() => undefined)
      .finally(refresh);
  }, [refresh]);

  const openExact = useCallback(() => {
    void PrayerAlarm.openExactAlarmSettings().catch(() => undefined).finally(refresh);
  }, [refresh]);

  const openFullScreen = useCallback(() => {
    void PrayerAlarm.openFullScreenIntentSettings().catch(() => undefined).finally(refresh);
  }, [refresh]);

  const openBattery = useCallback(() => {
    void PrayerAlarm.openBatterySettings().catch(() => undefined).finally(refresh);
  }, [refresh]);

  return { state, refresh, requestNotifications, openExact, openFullScreen, openBattery };
}
