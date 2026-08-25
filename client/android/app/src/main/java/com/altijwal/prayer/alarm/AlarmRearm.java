package com.altijwal.prayer.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.ArrayList;
import java.util.List;

/**
 * The single re-sync path (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3d): reload the
 * store, notify for missed alarm-kind instants, prune the past, re-arm the future
 * (fire + pre) with the scheduler's cap/isolation, re-arm the daily maintenance
 * canary, and post the horizon-refresh nag when the future runs thin (§3e).
 *
 * <p>Invoked by BootReceiver on boot / package-replace / exact-alarm grant / the
 * canary tick. Also the home for the reliability notifications shared with
 * AlarmReceiver and AlarmService (missed / pre / refresh). Must NOT start a
 * foreground service here (Android 15 restriction) — AlarmManager + notifications
 * only.
 */
public final class AlarmRearm {
    private static final String TAG = "PrayerAlarm";

    /** App-internal canary action delivered to BootReceiver via an explicit intent. */
    public static final String ACTION_MAINTENANCE = "com.altijwal.prayer.MAINTENANCE";

    private static final int CANARY_REQUEST_CODE = 0x0CA0;
    private static final int MISSED_NOTIFICATION_ID = 0xA1A4; // single fixed id — latest missed wins
    private static final int REFRESH_NOTIFICATION_ID = 0xA1A5; // single fixed id
    private static final long DAY_MS = 24 * 60 * 60_000L;
    private static final long HORIZON_MIN_MS = 48 * 60 * 60_000L;

    private AlarmRearm() {}

    /** Reload → missed notices → prune → re-arm future → canary → horizon nag (§3d). */
    public static void resyncFromStore(Context ctx) {
        AlarmStore store = new AlarmStore(ctx);
        AlarmScheduler scheduler = new AlarmScheduler(ctx);
        long now = System.currentTimeMillis();
        List<ScheduledAlarm> future = new ArrayList<>();
        String missedTitle = null; // set inside the transaction, posted after it

        // One transaction against the fire receiver's removeById (§ finding 1).
        synchronized (AlarmStore.lock()) {
            // On a 2.4→2.5 store the receiver never removed fired ids, so a past
            // entry may have rung normally: the "past ⇒ never fired" invariant only
            // holds once this build has written the store. Suppress missed notices on
            // that first resync (§ finding 4).
            boolean invariant = store.missedInvariantEstablished();

            List<ScheduledAlarm> all = store.load();
            ScheduledAlarm latestMissed = null; // latest past alarm-kind entry (§1.3)
            for (ScheduledAlarm a : all) {
                if (store.isDismissed(a.id, a.at)) continue; // occurrence turned off (§2) — don't re-arm nor flag missed
                if (a.at > now) {
                    future.add(a);
                } else if (a.isAlarm()) {
                    if (latestMissed == null || a.at > latestMissed.at) latestMissed = a;
                }
            }

            // A past alarm-kind entry still in the store provably never fired
            // (AlarmReceiver removes the id on every fire), so it was missed. One
            // notice, latest wins — but only once the invariant is established.
            if (invariant && latestMissed != null) {
                missedTitle = latestMissed.title;
            }

            scheduler.cancelAll(all);      // clear any lingering PIs (past + future)
            scheduler.scheduleAll(future); // re-arm the future with the §3b cap/isolation
            store.save(future);            // prune past instants (meta preserved)
            if (!invariant) store.establishMissedInvariant();

            // Bootstrap the §3e meta for a 2.4-migrated store (alarms present but no
            // meta was ever written), so the horizon nag can fire for exactly the
            // update-then-never-opened users it exists for (§ finding 3).
            if (!all.isEmpty() && store.lastSyncAt() == 0) {
                store.setSyncMeta(true, now);
            }
        }

        if (missedTitle != null) postMissed(ctx, missedTitle, false);
        armCanary(ctx);
        maybeNagHorizon(ctx, store, future, now);
    }

    // ── daily maintenance canary (§3d) ───────────────────────────────────────

    /** Arm one inexact alarm 24 h out so a re-sync fires even if the app is never
     *  opened; inexact so it survives exact-alarm revocation (P3). */
    public static void armCanary(Context ctx) {
        AlarmManager am = alarmManager(ctx);
        if (am == null) return;
        try {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + DAY_MS, canaryPi(ctx));
        } catch (RuntimeException e) {
            Log.e(TAG, "canary arm failed", e);
        }
    }

    public static void cancelCanary(Context ctx) {
        AlarmManager am = alarmManager(ctx);
        if (am == null) return;
        try {
            am.cancel(canaryPi(ctx));
        } catch (RuntimeException ignored) {
        }
    }

    private static PendingIntent canaryPi(Context ctx) {
        Intent i = new Intent(ctx.getApplicationContext(), BootReceiver.class).setAction(ACTION_MAINTENANCE);
        return PendingIntent.getBroadcast(ctx.getApplicationContext(), CANARY_REQUEST_CODE, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ── reliability notifications (shared) ───────────────────────────────────

    /**
     * Post the missed-alarm notice (§1): {@code missedTitle} with {prayer} ← the
     * alarm's stored title, body {@code missedRang} when it rang out unstopped or
     * {@code missedNotFired} when it never rang / was stale-skipped.
     */
    public static void postMissed(Context ctx, String prayerTitle, boolean rangOut) {
        AlarmChannels.ensure(ctx);
        AlarmTexts texts = new AlarmTexts(ctx);
        String title = AlarmTexts.substitute(texts.missedTitle(), prayerTitle, null);
        String body = rangOut ? texts.missedRang() : texts.missedNotFired();
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, AlarmChannels.REMINDER)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(launchPendingIntent(ctx, MISSED_NOTIFICATION_ID));
        try {
            NotificationManagerCompat.from(ctx).notify(MISSED_NOTIFICATION_ID, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted — nothing to show
        }
    }

    public static void clearRefreshNag(Context ctx) {
        NotificationManagerCompat.from(ctx).cancel(REFRESH_NOTIFICATION_ID);
    }

    /** App-launch content PendingIntent (same pattern as AlarmReceiver.postReminder). */
    static PendingIntent launchPendingIntent(Context ctx, int requestCode) {
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (open == null) open = new Intent();
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(ctx, requestCode, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // ── horizon-refresh nag (§3e) ────────────────────────────────────────────

    private static void maybeNagHorizon(Context ctx, AlarmStore store, List<ScheduledAlarm> future, long now) {
        if (!store.lastSyncHadAlarms()) return; // the app never had alarms — nothing to refresh
        long latest = 0L;
        for (ScheduledAlarm a : future) {
            if (a.at > latest) latest = a.at;
        }
        boolean thin = future.isEmpty() || latest < now + HORIZON_MIN_MS;
        if (!thin) return;

        AlarmChannels.ensure(ctx);
        AlarmTexts texts = new AlarmTexts(ctx);
        // Silent channel: the canary can tick at any hour, so the nag must never
        // ding (§ finding 4). Missed notices deliberately stay on REMINDER (audible).
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, AlarmChannels.PREALARM)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(texts.refreshTitle())
                .setContentText(texts.refreshBody())
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setContentIntent(launchPendingIntent(ctx, REFRESH_NOTIFICATION_ID));
        try {
            NotificationManagerCompat.from(ctx).notify(REFRESH_NOTIFICATION_ID, b.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS not granted — nothing to show
        }
    }

    private static AlarmManager alarmManager(Context ctx) {
        return (AlarmManager) ctx.getApplicationContext().getSystemService(Context.ALARM_SERVICE);
    }
}
