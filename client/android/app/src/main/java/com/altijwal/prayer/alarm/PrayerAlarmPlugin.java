package com.altijwal.prayer.alarm;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Window;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Bridges the JS PrayerAlarm API (client/src/lib/native.ts) to on-device alarm
 * scheduling. All prayer-time math happens in JS; this plugin only arms/cancels
 * AlarmManager alarms, reports permission state, and opens the relevant settings
 * screens (docs/NATIVE_ALARM_SPEC.md §3d/§3f).
 */
@CapacitorPlugin(
        name = "PrayerAlarm",
        permissions = {
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        })
public class PrayerAlarmPlugin extends Plugin {

    private AlarmStore store;
    private AlarmScheduler scheduler;

    @Override
    public void load() {
        Context ctx = getContext();
        store = new AlarmStore(ctx);
        scheduler = new AlarmScheduler(ctx);
        AlarmChannels.ensure(ctx);
    }

    @PluginMethod
    public void replaceAll(PluginCall call) {
        JSArray arr = call.getArray("alarms");
        List<ScheduledAlarm> next = parseAlarms(arr);

        // Persist the localized text map (§4) so the pre/missed/refresh notices render
        // even pre-unlock / after an update-then-never-opened; absent → AR defaults.
        JSObject texts = call.getObject("texts", null);
        if (texts != null) new AlarmTexts(getContext()).save(texts);

        // Ids of the incoming sync (before dismiss filtering): a dismiss suppression
        // whose occurrence no longer arrives from JS refers to a deleted rule and must
        // not outlive it, else recreating that rule (reused id + identical instant)
        // before the occurrence passes is silently muted (§ finding 3).
        Set<String> incomingIds = new HashSet<>();
        for (ScheduledAlarm a : next) incomingIds.add(a.id);

        // The replacement runs as one transaction against the fire receiver's
        // removeById, so a concurrent fire can't clobber the new set (§ finding 1).
        int failures;
        synchronized (AlarmStore.lock()) {
            long now = System.currentTimeMillis();
            store.retainDismissed(incomingIds); // drop suppressions for deleted rules (empty ⇒ map cleared)

            // `saved` = everything we keep in the store; `armable` = the subset we
            // actually arm. Drop dismissed occurrences (id + exact instant, §2). Any
            // instant already past by arm time is kept SAVED (so the next resync
            // reports it missed) but never armed — arming a past instant fires it
            // immediately, a duplicate ring (§ finding 1).
            List<ScheduledAlarm> saved = new ArrayList<>();
            List<ScheduledAlarm> armable = new ArrayList<>();
            for (ScheduledAlarm a : next) {
                if (store.isDismissed(a.id, a.at)) continue;
                saved.add(a);
                if (a.at > now) armable.add(a);
            }

            // §3c ordering: cancel the old set (incl. pre-PIs) → persist the new set +
            // meta BEFORE arming (a crash between save and arm self-heals at the next
            // resync, since the store is authoritative) → arm.
            List<ScheduledAlarm> old = store.load();
            scheduler.cancelAll(old);
            store.save(saved);
            store.setSyncMeta(!saved.isEmpty(), now);
            store.establishMissedInvariant(); // a 2.5 write: the §1.3 "past ⇒ never fired" invariant now holds
            failures = scheduler.scheduleAll(armable);
        }

        AlarmRearm.armCanary(getContext());
        AlarmRearm.clearRefreshNag(getContext());
        // Occurrences are stored-but-unarmed when arming throws mid-batch (permission
        // revoked between canScheduleExact and setAlarmClock): tell JS so its 5-second
        // retry re-runs the idempotent sync rather than trusting a false success (§ finding 2).
        if (failures > 0) {
            call.reject("scheduleAll: " + failures + " arm failures");
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        synchronized (AlarmStore.lock()) { // atomic against a concurrent fire (§ finding 1)
            scheduler.cancelAll(store.load()); // cancels fire + pre PIs
            AlarmRearm.cancelCanary(getContext());
            store.clear();
        }
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        Context ctx = getContext();
        JSObject res = new JSObject();
        res.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled() ? "granted" : "prompt");
        res.put("exactAlarm", scheduler.canScheduleExact());
        res.put("fullScreen", canUseFullScreenIntent());
        res.put("batteryExempt", isBatteryExempt());
        call.resolve(res);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject r = new JSObject();
            r.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notifPermCallback");
    }

    @PermissionCallback
    private void notifPermCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == com.getcapacitor.PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getContext().getPackageName()));
            startSafely(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                    Uri.parse("package:" + getContext().getPackageName()));
            startSafely(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName()));
        startSafely(i);
        call.resolve();
    }

    /**
     * Theme appearance bridge (docs/V2_REDESIGN_SPEC.md Phase 1 + 7): light themes
     * need dark system-bar icons, and the window backdrop should match the theme so
     * overscroll/keyboard gaps don't flash night-green. capacitor.config.ts keeps
     * SystemBars DARK as the pre-JS boot default; the web layer calls this after
     * applying the persisted theme. The optional `alarm` palette object is persisted
     * to AppearanceStore so AlarmActivity follows the theme even app-killed (Phase 7;
     * absent/malformed values fall back to the night palette).
     */
    @PluginMethod
    public void setAppearance(PluginCall call) {
        boolean light = Boolean.TRUE.equals(call.getBoolean("systemBarsLight", false));
        String bg = call.getString("bg");
        JSObject alarm = call.getObject("alarm", null);
        new AppearanceStore(getContext()).save(
                alarm == null ? null : alarm.getString("bg"),
                alarm == null ? null : alarm.getString("ink"),
                alarm == null ? null : alarm.getString("inkDim"),
                alarm == null ? null : alarm.getString("accent"));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            WindowInsetsControllerCompat bars =
                    WindowCompat.getInsetsController(window, window.getDecorView());
            bars.setAppearanceLightStatusBars(light);
            bars.setAppearanceLightNavigationBars(light);
            if (bg != null) {
                try {
                    window.getDecorView().setBackgroundColor(Color.parseColor(bg));
                } catch (IllegalArgumentException ignored) {
                    // malformed color — keep the current backdrop
                }
            }
            call.resolve();
        });
    }

    // ── device tones (dropdown "device tones" group) ─────────────────────────

    /** Tone id prefix shared with JS (lib/alarm-sounds DEVICE_TONE_PREFIX). */
    static final String DEVICE_TONE_PREFIX = "device:";

    private Ringtone previewRingtone;

    /** List the device's system alarm tones as { id: "device:<uri>", title }. */
    @PluginMethod
    public void listDeviceTones(PluginCall call) {
        JSArray tones = new JSArray();
        try {
            RingtoneManager rm = new RingtoneManager(getContext());
            rm.setType(RingtoneManager.TYPE_ALARM);
            Cursor cursor = rm.getCursor();
            while (cursor.moveToNext()) {
                String title = cursor.getString(RingtoneManager.TITLE_COLUMN_INDEX);
                Uri uri = rm.getRingtoneUri(cursor.getPosition());
                if (uri == null) continue;
                JSObject tone = new JSObject();
                tone.put("id", DEVICE_TONE_PREFIX + uri);
                tone.put("title", title == null ? "" : title);
                tones.put(tone);
            }
        } catch (Exception ignored) {
            // tone listing is best-effort — an empty list just hides the group
        }
        JSObject res = new JSObject();
        res.put("tones", tones);
        call.resolve(res);
    }

    /** Preview a device tone (webview audio cannot play content:// URIs). */
    @PluginMethod
    public void previewTone(PluginCall call) {
        String id = call.getString("id", "");
        stopPreviewRingtone();
        if (id != null && id.startsWith(DEVICE_TONE_PREFIX)) {
            try {
                Uri uri = Uri.parse(id.substring(DEVICE_TONE_PREFIX.length()));
                Ringtone r = RingtoneManager.getRingtone(getContext(), uri);
                if (r != null) {
                    r.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                    r.play();
                    previewRingtone = r;
                }
            } catch (Exception ignored) {
                // preview is best-effort
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void stopTonePreview(PluginCall call) {
        stopPreviewRingtone();
        call.resolve();
    }

    private void stopPreviewRingtone() {
        if (previewRingtone != null) {
            try {
                previewRingtone.stop();
            } catch (Exception ignored) {
            }
            previewRingtone = null;
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void startSafely(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception ignored) {
            // settings screen not available on this device/OS
        }
    }

    private boolean canUseFullScreenIntent() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true;
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        return nm != null && nm.canUseFullScreenIntent();
    }

    private boolean isBatteryExempt() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private List<ScheduledAlarm> parseAlarms(JSArray arr) {
        // JSArray extends org.json.JSONArray, so iterate it directly.
        List<ScheduledAlarm> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null) out.add(ScheduledAlarm.fromJson(o));
        }
        return out;
    }
}
