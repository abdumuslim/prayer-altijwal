package com.altijwal.prayer.alarm;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Fires at an alarm's instant. `alarm` kind hands off to the foreground
 * AlarmService (which rings the tone + shows the full-screen activity);
 * `notification` kind posts a quiet standard notification. A stale guard drops
 * fires more than 5 minutes late so a delayed wake can't ring at the wrong time
 * (docs/NATIVE_ALARM_SPEC.md §3f).
 */
public class AlarmReceiver extends BroadcastReceiver {
    private static final long STALE_MS = 5 * 60_000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        long at = intent.getLongExtra("at", 0L);
        if (at > 0 && System.currentTimeMillis() - at > STALE_MS) return; // stale — skip

        String kind = intent.getStringExtra("kind");
        AlarmChannels.ensure(context);

        if ("alarm".equals(kind)) {
            Intent svc = new Intent(context, AlarmService.class);
            svc.putExtras(intent);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } else {
            postReminder(context, intent);
        }
    }

    private void postReminder(Context context, Intent intent) {
        String title = orEmpty(intent.getStringExtra("title"));
        String body = orEmpty(intent.getStringExtra("body"));
        String target = orEmpty(intent.getStringExtra("target"));
        long at = intent.getLongExtra("at", System.currentTimeMillis());

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open == null) open = new Intent();
        open.setData(Uri.parse("https://prayer.altijwal.com/?alarm=" + target + "&t=" + at));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent contentPi = PendingIntent.getActivity(context, target.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, AlarmChannels.REMINDER)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(contentPi);

        try {
            NotificationManagerCompat.from(context).notify(("r-" + target).hashCode(), b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted — nothing to show
        }
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
