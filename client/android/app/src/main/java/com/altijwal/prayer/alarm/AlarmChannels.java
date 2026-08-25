package com.altijwal.prayer.alarm;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

/**
 * Notification channels for the reminder kinds. The alarm channel is SILENT
 * (the foreground service owns the looping tone via MediaPlayer, so the channel
 * must not also play a sound) and high-importance for the full-screen intent;
 * the reminder channel uses the default system sound (docs/NATIVE_ALARM_SPEC.md
 * §3f, D7). The pre-alarm channel is a quiet heads-up shown 30 min before an
 * alarm rings (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §2).
 */
public final class AlarmChannels {
    public static final String ALARM = "prayer_alarm_v1";
    public static final String REMINDER = "prayer_reminder_v1";
    public static final String PREALARM = "prayer_prealarm_v1";

    private AlarmChannels() {}

    public static void ensure(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        if (nm.getNotificationChannel(ALARM) == null) {
            NotificationChannel alarm = new NotificationChannel(
                    ALARM, "Prayer alarms", NotificationManager.IMPORTANCE_HIGH);
            alarm.setDescription("Full-screen prayer alarms");
            alarm.setSound(null, null); // service owns the tone
            alarm.enableVibration(false); // service owns vibration
            alarm.setBypassDnd(true);
            alarm.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(alarm);
        }

        if (nm.getNotificationChannel(REMINDER) == null) {
            NotificationChannel reminder = new NotificationChannel(
                    REMINDER, "Prayer reminders", NotificationManager.IMPORTANCE_DEFAULT);
            reminder.setDescription("Prayer time reminders");
            nm.createNotificationChannel(reminder);
        }

        if (nm.getNotificationChannel(PREALARM) == null) {
            // Quiet (the FGS never rings here) but visible on the lock screen so the
            // heads-up + turn-off button appear without waking anyone.
            NotificationChannel pre = new NotificationChannel(
                    PREALARM, "Upcoming prayer alarms", NotificationManager.IMPORTANCE_DEFAULT);
            pre.setSound(null, null);
            pre.enableVibration(false);
            pre.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(pre);
        }
    }
}
