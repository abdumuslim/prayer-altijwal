// First-launch permission onboarding (native only). A fresh install should be
// asked for what the alarms need right away — not discover the permission rows
// buried in Settings. Runs ONCE (localStorage marker): awaits the system
// notification dialog, then surfaces at most one settings/dialog screen for
// whatever the OS didn't auto-grant, in impact order (battery exemption is the
// common alarm-killer; exact-alarm + full-screen are auto-granted on stock
// Android via USE_EXACT_ALARM / alarm-app FSI policy). Anything still missing
// stays visible as fix rows in Settings → reminders (useAlarmPermissions).

import { useEffect } from "react";
import { isNative, PrayerAlarm } from "@/lib/native";

const PROMPTED_KEY = "prayer.perms.prompted.v1";

export function useFirstRunPermissions(): void {
  useEffect(() => {
    if (!isNative()) return;
    try {
      if (localStorage.getItem(PROMPTED_KEY)) return;
      localStorage.setItem(PROMPTED_KEY, "1");
    } catch {
      return; // storage unavailable — don't risk re-prompting every launch
    }

    void (async () => {
      try {
        // 1) Notifications — a real system dialog; resolves after the user acts.
        await PrayerAlarm.requestNotificationPermission();

        // 2) One more screen at most, by impact. openBatterySettings shows the
        //    system allow/deny dialog; the others open Settings pages. Chaining
        //    several would stack windows, so stop after the first missing one —
        //    the Settings rows cover the rest.
        const st = await PrayerAlarm.getState();
        if (!st.batteryExempt) {
          await PrayerAlarm.openBatterySettings();
        } else if (!st.exactAlarm) {
          await PrayerAlarm.openExactAlarmSettings();
        } else if (!st.fullScreen) {
          await PrayerAlarm.openFullScreenIntentSettings();
        }
      } catch (err) {
        console.error("[native-alarm] first-run permission prompt failed", err);
      }
    })();
  }, []);
}
