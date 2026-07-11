package com.altijwal.prayer.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.List;

/**
 * Arms/cancels OS-level alarms via AlarmManager.setAlarmClock() — the Doze-exempt
 * "gold standard" that fires at the exact instant even when the app is closed
 * (docs/NATIVE_ALARM_PLAN.md §5). Each alarm broadcasts to AlarmReceiver at its
 * fire time. All times are epoch ms computed on the JS side (hard rule 10 — no
 * timezone math here).
 */
public class AlarmScheduler {
    private final Context ctx;
    private final AlarmManager am;

    public AlarmScheduler(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.am = (AlarmManager) this.ctx.getSystemService(Context.ALARM_SERVICE);
    }

    private PendingIntent firePendingIntent(ScheduledAlarm a) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction("com.altijwal.prayer.FIRE_ALARM");
        i.setData(android.net.Uri.parse("prayeralarm://" + a.id)); // unique per alarm
        i.putExtra("id", a.id);
        i.putExtra("at", a.at);
        i.putExtra("kind", a.kind);
        i.putExtra("title", a.title);
        i.putExtra("body", a.body);
        i.putExtra("toneId", a.toneId);
        i.putExtra("target", a.target);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, a.requestCode(), i, flags);
    }

    /** PendingIntent that opens the app when the user taps the system alarm icon. */
    private PendingIntent showPendingIntent(ScheduledAlarm a) {
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent();
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, a.requestCode() ^ 0x5555, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public boolean canScheduleExact() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return am != null && am.canScheduleExactAlarms();
        }
        return true;
    }

    public void schedule(ScheduledAlarm a) {
        if (am == null) return;
        PendingIntent fire = firePendingIntent(a);
        if (canScheduleExact()) {
            AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(a.at, showPendingIntent(a));
            am.setAlarmClock(info, fire);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // Best effort without the exact-alarm permission: still wakes from Doze,
            // but may be delayed. The UI nudges the user to grant exact alarms.
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, fire);
        } else {
            am.setExact(AlarmManager.RTC_WAKEUP, a.at, fire);
        }
    }

    public void cancel(ScheduledAlarm a) {
        if (am == null) return;
        am.cancel(firePendingIntent(a));
    }

    public void scheduleAll(List<ScheduledAlarm> alarms) {
        for (ScheduledAlarm a : alarms) schedule(a);
    }

    public void cancelAll(List<ScheduledAlarm> alarms) {
        for (ScheduledAlarm a : alarms) cancel(a);
    }
}
