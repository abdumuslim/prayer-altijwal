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
    private static final int FGS_ID = 0xA1A2;
    private static final long RING_MS = 2 * 60_000L;

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = this::stopEverything;

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

        AlarmChannels.ensure(this);
        String title = orEmpty(intent != null ? intent.getStringExtra("title") : "");
        String body = orEmpty(intent != null ? intent.getStringExtra("body") : "");
        String toneId = orEmpty(intent != null ? intent.getStringExtra("toneId") : "");
        String target = orEmpty(intent != null ? intent.getStringExtra("target") : "");
        long at = intent != null ? intent.getLongExtra("at", System.currentTimeMillis()) : System.currentTimeMillis();

        startForegroundWithNotification(title, body, target, at);
        startTone(toneId);
        startVibration();

        handler.removeCallbacks(autoStop);
        handler.postDelayed(autoStop, RING_MS);
        return START_NOT_STICKY;
    }

    private void startForegroundWithNotification(String title, String body, String target, long at) {
        Intent full = new Intent(this, AlarmActivity.class);
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_HISTORY);
        full.putExtra("title", title);
        full.putExtra("body", body);
        full.putExtra("target", target);
        full.putExtra("at", at);
        PendingIntent fullPi = PendingIntent.getActivity(this, 1, full,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, AlarmService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 2, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, AlarmChannels.ALARM)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(FGS_ID, b.build(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(FGS_ID, b.build());
        }
    }

    private void startTone(String toneId) {
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build());
            boolean set = false;
            if (!toneId.isEmpty()) {
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
