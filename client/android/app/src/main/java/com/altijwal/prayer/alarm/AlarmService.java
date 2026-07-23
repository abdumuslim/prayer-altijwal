package com.altijwal.prayer.alarm;

import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that RINGS an alarm-kind fire: it plays the user's chosen
 * tone in a 2-minute loop on the alarm audio stream, vibrates, and posts a
 * full-screen-intent notification that launches AlarmActivity over the lock
 * screen. Auto-stops after 2 minutes or when the user hits Stop
 * (docs/NATIVE_ALARM_SPEC.md §3f, D7).
 */
public class AlarmService extends Service {
    public static final String ACTION_STOP = "com.altijwal.prayer.STOP_ALARM";
    /** Fired by the notification's delete intent — see onStartCommand. */
    public static final String ACTION_REPOST = "com.altijwal.prayer.REPOST_ALARM";
    /**
     * Broadcast (app-internal, NOT exported) the instant the ring ends, for any
     * reason: Stop, the 2-minute cap, or the shortService timeout. AlarmActivity
     * listens and finishes itself — the ringing screen must never outlive the
     * ring now that it is no longer a NO_HISTORY activity.
     */
    public static final String ACTION_ENDED = "com.altijwal.prayer.ALARM_ENDED";
    private static final int FGS_ID = 0xA1A2;
    private static final long RING_MS = 2 * 60_000L;

    /**
     * True while an alarm is actually ringing. Read by AlarmActivity on resume so
     * a screen relaunched from a stale notification (or one that resumes just
     * after the ring ended) closes itself instead of showing a dead alarm.
     */
    private static volatile boolean sRinging;

    public static boolean isRinging() {
        return sRinging;
    }

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stopEverything;

    // Last fire's notification content, kept so a swiped-away notification can be
    // rebuilt identically (users were dismissing the alarm by swiping it out).
    private String lastTitle = "";
    private String lastBody = "";
    private String lastTarget = "";
    private String lastUntilLabel = "";
    private long lastAt;
    private long lastAnchorAt;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopEverything();
            return START_NOT_STICKY;
        }

        // Android 14+ lets users swipe an ongoing FGS notification away, which
        // used to leave the alarm ringing with no visible way back to it. The
        // delete intent lands here: while we are still ringing, put it straight
        // back. Only a real Stop (or the 2-min cap) silences the alarm.
        if (intent != null && ACTION_REPOST.equals(intent.getAction())) {
            if (sRinging) {
                AlarmChannels.ensure(this);
                androidx.core.app.NotificationManagerCompat.from(this)
                        .notify(FGS_ID, buildNotification(lastTitle, lastBody, lastTarget,
                                lastAt, lastAnchorAt, lastUntilLabel));
            }
            return START_NOT_STICKY;
        }

        AlarmChannels.ensure(this);
        String title = orEmpty(intent != null ? intent.getStringExtra("title") : "");
        String body = orEmpty(intent != null ? intent.getStringExtra("body") : "");
        String toneId = orEmpty(intent != null ? intent.getStringExtra("toneId") : "");
        String target = orEmpty(intent != null ? intent.getStringExtra("target") : "");
        String untilLabel = orEmpty(intent != null ? intent.getStringExtra("untilLabel") : "");
        long at = intent != null ? intent.getLongExtra("at", System.currentTimeMillis()) : System.currentTimeMillis();
        long anchorAt = intent != null ? intent.getLongExtra("anchorAt", at) : at;

        startForegroundWithNotification(title, body, target, at, anchorAt, untilLabel);
        startTone(toneId);
        startVibration();

        handler.removeCallbacks(autoStop);
        handler.postDelayed(autoStop, RING_MS);
        return START_NOT_STICKY;
    }

    private void startForegroundWithNotification(String title, String body, String target,
                                                 long at, long anchorAt, String untilLabel) {
        sRinging = true;
        lastTitle = title;
        lastBody = body;
        lastTarget = target;
        lastAt = at;
        lastAnchorAt = anchorAt;
        lastUntilLabel = untilLabel;

        android.app.Notification n = buildNotification(title, body, target, at, anchorAt, untilLabel);
        // shortService (API 34+): the ring is hard-capped at 2 min, well inside the
        // ~3-min shortService window — and unlike mediaPlayback it needs no
        // type permission and no Play Console FGS declaration/demo video
        // (docs/PLAY_RELEASE.md). Pre-34 devices don't enforce FGS types.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(FGS_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        } else {
            startForeground(FGS_ID, n);
        }
    }

    private android.app.Notification buildNotification(String title, String body, String target,
                                                       long at, long anchorAt, String untilLabel) {
        Intent full = new Intent(this, AlarmActivity.class);
        // NO_HISTORY must NOT be set: it finishes the ringing screen the moment the
        // user navigates away from it, and unlocking a secured phone counts as
        // navigating away — the alarm screen vanished for good while the service
        // kept ringing headless. The screen is instead torn down deliberately when
        // the ring ends (ACTION_ENDED below).
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        full.putExtra("title", title);
        full.putExtra("body", body);
        full.putExtra("target", target);
        full.putExtra("at", at);
        full.putExtra("anchorAt", anchorAt);
        full.putExtra("untilLabel", untilLabel);
        PendingIntent fullPi = PendingIntent.getActivity(this, 1, full,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, AlarmService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 2, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent repost = new Intent(this, AlarmService.class).setAction(ACTION_REPOST);
        PendingIntent repostPi = PendingIntent.getService(this, 3, repost,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, AlarmChannels.ALARM)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi)
                .setDeleteIntent(repostPi)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi)
                .build();
    }

    @Override
    public void onTimeout(int startId) {
        // shortService timeout (~3 min) — must stop promptly or the system ANRs
        // the app. The 2-min auto-stop normally fires first; this is the backstop.
        stopEverything();
    }

    private void startTone(String toneId) {
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build());
            boolean set = false;
            if (toneId.startsWith(PrayerAlarmPlugin.DEVICE_TONE_PREFIX)) {
                // A system (device) tone chosen in the dropdown — play its content URI.
                try {
                    android.net.Uri uri = android.net.Uri.parse(
                            toneId.substring(PrayerAlarmPlugin.DEVICE_TONE_PREFIX.length()));
                    player.setDataSource(this, uri);
                    set = true;
                } catch (Exception ignored) {
                    // tone gone/unreadable — fall through to the default alarm ringtone
                }
            } else if (!toneId.isEmpty()) {
                try {
                    AssetFileDescriptor afd = getAssets().openFd("public/alarms/" + toneId + ".mp3");
                    player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                    afd.close();
                    set = true;
                } catch (Exception ignored) {
                    // fall through to the default alarm ringtone
                }
            }
            if (!set) {
                player.setDataSource(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            }
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            releasePlayer();
        }
    }

    private void startVibration() {
        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        long[] pattern = {0, 700, 900};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } else {
            vibrator.vibrate(pattern, 0);
        }
    }

    private void stopEverything() {
        boolean wasRinging = sRinging;
        sRinging = false; // stop re-posting: a delete after this is a real dismissal
        // Tear the ringing screen down with the ring (it survives navigation now).
        if (wasRinging) {
            sendBroadcast(new Intent(ACTION_ENDED).setPackage(getPackageName()));
        }
        handler.removeCallbacks(autoStop);
        releasePlayer();
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        stopForeground(true);
        stopSelf();
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                if (player.isPlaying()) player.stop();
            } catch (IllegalStateException ignored) {
            }
            player.release();
            player = null;
        }
    }

    @Override
    public void onDestroy() {
        stopEverything();
        super.onDestroy();
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
