package com.altijwal.prayer.alarm;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Fires at an alarm's instant. `alarm` kind hands off to the foreground
 * AlarmService (which rings the tone + shows the full-screen activity);
 * `notification` kind posts a quiet standard notification. A stale guard drops
 * fires more than 5 minutes late so a delayed wake can't ring at the wrong time
 * (docs/NATIVE_ALARM_SPEC.md §3f).
 *
 * <p>Also handles the pre-alarm heads-up armed 30 min earlier (PRE_ALARM) and its
 * turn-off button (DISMISS_UPCOMING), and enforces the §1.3 invariant: the fired
 * id is removed from AlarmStore on every fire, so a past alarm-kind entry left in
 * the store at re-sync provably never fired (docs/NATIVE_ALARM_RELIABILITY_SPEC.md
 * §1/§2).
 */
public class AlarmReceiver extends BroadcastReceiver {
    public static final String ACTION_FIRE = "com.altijwal.prayer.FIRE_ALARM";
    public static final String ACTION_PRE_ALARM = "com.altijwal.prayer.PRE_ALARM";
    public static final String ACTION_DISMISS_UPCOMING = "com.altijwal.prayer.DISMISS_UPCOMING";

    private static final String TAG = "PrayerAlarm";
    private static final long STALE_MS = 5 * 60_000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        AlarmChannels.ensure(context);
        String action = intent.getAction();
        if (ACTION_PRE_ALARM.equals(action)) {
            onPreAlarm(context, intent);
        } else if (ACTION_DISMISS_UPCOMING.equals(action)) {
            onDismissUpcoming(context, intent);
        } else {
            onFire(context, intent);
        }
    }

    private void onFire(Context context, Intent intent) {
        String id = intent.getStringExtra("id");
        String kind = intent.getStringExtra("kind");
        long at = intent.getLongExtra("at", 0L);

        // §1.3 invariant: remove the fired id on every fire, and clear its pending
        // heads-up (a no-op for notification-kind, which has none).
        if (id != null && !id.isEmpty()) {
            new AlarmStore(context).removeById(id);
            cancelPreNotification(context, id);
        }

        if (at > 0 && System.currentTimeMillis() - at > STALE_MS) {
            // Stale — skip. An alarm-kind stale skip still tells the user it was
            // missed (§1.2).
            if ("alarm".equals(kind)) {
                AlarmRearm.postMissed(context, orEmpty(intent.getStringExtra("title")), false);
            }
            return;
        }

        if ("alarm".equals(kind)) {
            Intent svc = new Intent(context, AlarmService.class);
            svc.putExtras(intent);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(svc);
                } else {
                    context.startService(svc);
                }
            } catch (RuntimeException e) {
                // An inexact-fallback fire (no exact grant, P4) carries no FGS
                // background-start exemption on API 31+, so the service start can
                // throw. Alert the user once via the default-sound notification
                // instead of silently dropping the alarm (§ finding 1). The id was
                // already removed above — leave it removed.
                Log.e(TAG, "alarm FGS start failed id=" + id, e);
                postReminder(context, intent);
            }
        } else {
            postReminder(context, intent);
        }
    }

    /** Heads-up 30 min before an alarm rings (§2), with a turn-off action button. */
    private void onPreAlarm(Context context, Intent intent) {
        String id = intent.getStringExtra("id");
        if (id == null || id.isEmpty()) return;
        // Only show if still armed (not deleted / re-synced away).
        boolean stillArmed = false;
        for (ScheduledAlarm a : new AlarmStore(context).load()) {
            if (id.equals(a.id)) {
                stillArmed = true;
                break;
            }
        }
        if (!stillArmed) return;

        String prayer = orEmpty(intent.getStringExtra("title"));
        long at = intent.getLongExtra("at", 0L);
        long mins = at > 0 ? Math.round((at - System.currentTimeMillis()) / 60000.0) : 30;
        if (mins < 0) mins = 0;

        AlarmTexts texts = new AlarmTexts(context);
        String title = AlarmTexts.substitute(texts.preTitle(), prayer, String.valueOf(mins));
        String body = AlarmTexts.substitute(texts.preBody(), prayer, null);

        Intent dismiss = new Intent(context, AlarmReceiver.class);
        dismiss.setAction(ACTION_DISMISS_UPCOMING);
        dismiss.setData(Uri.parse("prayeralarm-dismiss://" + id));
        dismiss.putExtras(intent);
        PendingIntent dismissPi = PendingIntent.getBroadcast(context, ("pre-dismiss-" + id).hashCode(),
                dismiss, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(context, AlarmChannels.PREALARM)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(AlarmRearm.launchPendingIntent(context, ("pre-open-" + id).hashCode()))
                .addAction(android.R.drawable.ic_lock_idle_alarm, texts.preAction(), dismissPi);
        try {
            NotificationManagerCompat.from(context).notify(preNotificationId(id), b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted — nothing to show
        }
    }

    /** Turn off one upcoming alarm from its heads-up, without opening the app (§2). */
    private void onDismissUpcoming(Context context, Intent intent) {
        String id = intent.getStringExtra("id");
        if (id == null || id.isEmpty()) return;
        long at = intent.getLongExtra("at", System.currentTimeMillis());

        AlarmStore store = new AlarmStore(context);
        AlarmScheduler scheduler = new AlarmScheduler(context);
        // One transaction against a concurrent JS/maintenance resync (§ finding 1):
        // record the suppression FIRST (so a resync that next wins the lock already
        // sees it and won't re-arm), then cancel the PIs, then drop it from the store.
        synchronized (AlarmStore.lock()) {
            store.addDismissed(id, at);
            scheduler.cancelById(id); // cancel fire + pre PIs
            store.removeById(id);     // resync can't resurrect it → no missed notice
        }
        cancelPreNotification(context, id);

        String prayer = orEmpty(intent.getStringExtra("title"));
        AlarmTexts texts = new AlarmTexts(context);
        String title = AlarmTexts.substitute(texts.preStopped(), prayer, null);
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, AlarmChannels.PREALARM)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setAutoCancel(true)
                .setTimeoutAfter(15_000L)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(AlarmRearm.launchPendingIntent(context, ("pre-open-" + id).hashCode()));
        try {
            NotificationManagerCompat.from(context).notify(preNotificationId(id), b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted — nothing to show
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

    private static void cancelPreNotification(Context context, String id) {
        NotificationManagerCompat.from(context).cancel(preNotificationId(id));
    }

    /** Notification id for an alarm's pre-alarm + turn-off confirmation (§2). Also
     *  used by AlarmScheduler.cancel/cancelById to clear a lingering heads-up. */
    static int preNotificationId(String id) {
        return ("pre-" + id).hashCode();
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
