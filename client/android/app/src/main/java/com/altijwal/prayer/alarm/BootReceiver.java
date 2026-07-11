package com.altijwal.prayer.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import java.util.ArrayList;
import java.util.List;

/**
 * Re-arms all future alarms after a reboot (Android clears AlarmManager on
 * reboot). Reads the persisted set from AlarmStore, drops instants already in
 * the past, and re-schedules the rest. Must NOT start a foreground service here
 * (Android 15 restriction) — it only calls AlarmManager (docs/NATIVE_ALARM_SPEC.md
 * §3f, D3).
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        if (!action.equals(Intent.ACTION_BOOT_COMPLETED)
                && !action.equals("android.intent.action.LOCKED_BOOT_COMPLETED")
                && !action.equals(Intent.ACTION_MY_PACKAGE_REPLACED)) {
            return;
        }

        AlarmStore store = new AlarmStore(context);
        AlarmScheduler scheduler = new AlarmScheduler(context);
        long now = System.currentTimeMillis();

        List<ScheduledAlarm> future = new ArrayList<>();
        for (ScheduledAlarm a : store.load()) {
            if (a.at > now) {
                scheduler.schedule(a);
                future.add(a);
            }
        }
        store.save(future); // prune past instants
    }
}
