package com.altijwal.prayer.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * The generic re-sync receiver: re-arms the persisted alarm set after events that
 * clear or threaten it — reboot (AlarmManager is wiped), app update, exact-alarm
 * grant (P3), and the daily maintenance canary — by delegating to
 * AlarmRearm.resyncFromStore (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3d). It must
 * NOT start a foreground service here (Android 15 restriction) — resync only
 * touches AlarmManager + notifications.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        // The exact-alarm broadcast fires on GRANT only (never revoke, P3); the
        // canary (MAINTENANCE) arrives via an explicit intent so it needs no filter.
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.LOCKED_BOOT_COMPLETED".equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(action)
                || AlarmRearm.ACTION_MAINTENANCE.equals(action)) {
            AlarmRearm.resyncFromStore(context);
        }
    }
}
