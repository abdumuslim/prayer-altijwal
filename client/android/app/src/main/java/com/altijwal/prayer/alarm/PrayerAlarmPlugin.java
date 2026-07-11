package com.altijwal.prayer.alarm;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

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
import java.util.List;

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

        // Cancel everything currently armed, then arm the new set.
        scheduler.cancelAll(store.load());
        scheduler.scheduleAll(next);
        store.save(next);
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        scheduler.cancelAll(store.load());
        store.clear();
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
