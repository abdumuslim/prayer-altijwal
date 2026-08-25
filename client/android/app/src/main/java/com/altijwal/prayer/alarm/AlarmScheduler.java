package com.altijwal.prayer.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationManagerCompat;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Arms/cancels OS-level alarms via AlarmManager. An exact-alarm grant uses
 * setAlarmClock() — the Doze-exempt "gold standard" that fires at the exact
 * instant even when the app is closed (docs/NATIVE_ALARM_PLAN.md §5); without
 * the grant it falls back to inexact setAndAllowWhileIdle (never
 * setExactAndAllowWhileIdle, which throws SecurityException on API 31+ without
 * the grant — docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3b/P4).
 *
 * <p>Every alarm-kind fire also arms a quiet "pre-alarm" 30 min earlier (§2), and
 * each arm/cancel is fault-isolated so one failure never aborts a batch (§3b/P6).
 * All times are epoch ms computed on the JS side (hard rule 10 — no timezone math).
 */
public class AlarmScheduler {
    private static final String TAG = "PrayerAlarm";
    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    private static final long PRE_LEAD_MS = 30 * 60_000L;
    /** ~500 alarms per UID hard cap (P6): keep fires under 440, total (fire+pre) under 490. */
    private static final int MAX_FIRE = 440;
    private static final int MAX_TOTAL = 490;

    private final Context ctx;
    private final AlarmManager am;

    public AlarmScheduler(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.am = (AlarmManager) this.ctx.getSystemService(Context.ALARM_SERVICE);
    }

    private static void putExtras(Intent i, ScheduledAlarm a) {
        i.putExtra("id", a.id);
        i.putExtra("at", a.at);
        i.putExtra("kind", a.kind);
        i.putExtra("title", a.title);
        i.putExtra("body", a.body);
        i.putExtra("toneId", a.toneId);
        i.putExtra("target", a.target);
        i.putExtra("anchorAt", a.anchorAt);
        i.putExtra("untilLabel", a.untilLabel);
    }

    private PendingIntent firePendingIntent(ScheduledAlarm a) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(AlarmReceiver.ACTION_FIRE);
        i.setData(Uri.parse("prayeralarm://" + a.id)); // unique per alarm
        putExtras(i, a);
        return PendingIntent.getBroadcast(ctx, a.requestCode(), i, PI_FLAGS);
    }

    /** The heads-up PI armed 30 min before an alarm-kind fire (§2). Same extras. */
    private PendingIntent prePendingIntent(ScheduledAlarm a) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction(AlarmReceiver.ACTION_PRE_ALARM);
        i.setData(Uri.parse("prayeralarm-pre://" + a.id));
        putExtras(i, a);
        return PendingIntent.getBroadcast(ctx, a.requestCode() ^ 0x3333, i, PI_FLAGS);
    }

    /** PendingIntent that opens the app when the user taps the system alarm icon. */
    private PendingIntent showPendingIntent(ScheduledAlarm a) {
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent();
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, a.requestCode() ^ 0x5555, open, PI_FLAGS);
    }

    public boolean canScheduleExact() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return am != null && am.canScheduleExactAlarms();
        }
        return true; // pre-31: exact alarms need no permission
    }

    /** Arm one fire PI, fault-isolated. Returns false (and logs) on failure. */
    private boolean armFire(ScheduledAlarm a) {
        try {
            PendingIntent fire = firePendingIntent(a);
            if (canScheduleExact()) {
                AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(a.at, showPendingIntent(a));
                am.setAlarmClock(info, fire);
            } else {
                // No exact-alarm grant: inexact wakeup. Never setExactAndAllowWhileIdle
                // here — it throws SecurityException without the grant and would abort
                // the whole batch (§3b/P4).
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, a.at, fire);
            }
            return true;
        } catch (RuntimeException e) {
            Log.e(TAG, "arm fire failed id=" + a.id, e);
            return false;
        }
    }

    /** Arm the pre-alarm PI, fault-isolated. Skips (returns false) when too close. */
    private boolean armPre(ScheduledAlarm a) {
        long preAt = a.at - PRE_LEAD_MS;
        if (preAt <= System.currentTimeMillis() + 60_000L) return false; // too close/past
        try {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, preAt, prePendingIntent(a));
            return true;
        } catch (RuntimeException e) {
            Log.e(TAG, "arm pre failed id=" + a.id, e);
            return false;
        }
    }

    public void cancel(ScheduledAlarm a) {
        if (am == null) return;
        try {
            am.cancel(firePendingIntent(a));
        } catch (RuntimeException ignored) {
        }
        try {
            am.cancel(prePendingIntent(a));
        } catch (RuntimeException ignored) {
        }
        // Also clear any heads-up already showing for this id — its stop button would
        // otherwise dangle after the rule is deleted/re-scheduled (§ finding 3).
        NotificationManagerCompat.from(ctx).cancel(AlarmReceiver.preNotificationId(a.id));
    }

    /**
     * Cancel the fire + pre PIs for an id without the full ScheduledAlarm — used by
     * the dismiss-upcoming path, where the alarm may already be pruned (§2). Cancel
     * matches on requestCode + action + data (extras are irrelevant), all derived
     * from the id.
     */
    public void cancelById(String id) {
        if (am == null || id == null || id.isEmpty()) return;
        int code = id.hashCode();
        Intent fire = new Intent(ctx, AlarmReceiver.class)
                .setAction(AlarmReceiver.ACTION_FIRE)
                .setData(Uri.parse("prayeralarm://" + id));
        Intent pre = new Intent(ctx, AlarmReceiver.class)
                .setAction(AlarmReceiver.ACTION_PRE_ALARM)
                .setData(Uri.parse("prayeralarm-pre://" + id));
        try {
            am.cancel(PendingIntent.getBroadcast(ctx, code, fire, PI_FLAGS));
        } catch (RuntimeException ignored) {
        }
        try {
            am.cancel(PendingIntent.getBroadcast(ctx, code ^ 0x3333, pre, PI_FLAGS));
        } catch (RuntimeException ignored) {
        }
        NotificationManagerCompat.from(ctx).cancel(AlarmReceiver.preNotificationId(id));
    }

    /**
     * Arm the batch nearest-first with the UID cap and per-alarm fault isolation
     * (§3b): fire PIs up to MAX_FIRE, then pre-alarms for those fires while the
     * total stays under MAX_TOTAL. Returns the number of fires that failed to arm;
     * logs a summary (and any capped drops) to logcat.
     */
    public int scheduleAll(List<ScheduledAlarm> alarms) {
        if (am == null || alarms == null) return 0;
        List<ScheduledAlarm> sorted = new ArrayList<>(alarms);
        Collections.sort(sorted, (x, y) -> Long.compare(x.at, y.at));

        int failures = 0;
        int dropped = 0;
        int armed = 0; // total PIs armed (fire + pre)
        List<ScheduledAlarm> firedOk = new ArrayList<>();

        // Fire PIs first: nearest-first up to the fire cap.
        int fires = 0;
        for (ScheduledAlarm a : sorted) {
            if (fires >= MAX_FIRE) {
                dropped++;
                continue;
            }
            if (armFire(a)) {
                fires++;
                armed++;
                firedOk.add(a);
            } else {
                failures++;
            }
        }
        // Pre-alarms for the armed alarm-kind fires, nearest-first, until the total cap.
        for (ScheduledAlarm a : firedOk) {
            if (armed >= MAX_TOTAL) break;
            if (!a.isAlarm()) continue;
            if (armPre(a)) armed++;
        }

        if (failures > 0 || dropped > 0) {
            Log.e(TAG, "scheduleAll armed=" + armed + " failures=" + failures + " dropped=" + dropped);
        }
        return failures;
    }

    public void cancelAll(List<ScheduledAlarm> alarms) {
        if (alarms == null) return;
        for (ScheduledAlarm a : alarms) cancel(a);
    }
}
