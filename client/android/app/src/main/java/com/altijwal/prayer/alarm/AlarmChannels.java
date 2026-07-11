package com.altijwal.prayer.alarm;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

/**
 * Notification channels for the two reminder kinds. The alarm channel is SILENT
 * (the foreground service owns the looping tone via MediaPlayer, so the channel
 * must not also play a sound) and high-importance for the full-screen intent;
 * the reminder channel uses the default system sound (docs/NATIVE_ALARM_SPEC.md
 * §3f, D7).
 */
public final class AlarmChannels {
    public static final String ALARM = "prayer_alarm_v1";
    public static final String REMINDER = "prayer_reminder_v1";

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
    }
}
