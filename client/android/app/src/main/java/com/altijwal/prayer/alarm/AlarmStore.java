package com.altijwal.prayer.alarm;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Persists the currently-armed alarm set as JSON in SharedPreferences so
 * BootReceiver can re-arm everything after a reboot (docs/NATIVE_ALARM_SPEC.md
 * §3f). The scheduler is the single writer (replaceAll / cancelAll).
 */
public class AlarmStore {
    private static final String PREFS = "prayer_alarm_store";
    private static final String KEY = "alarms";

    private final SharedPreferences prefs;

    public AlarmStore(Context ctx) {
        this.prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public List<ScheduledAlarm> load() {
        List<ScheduledAlarm> out = new ArrayList<>();
        String raw = prefs.getString(KEY, null);
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null) out.add(ScheduledAlarm.fromJson(o));
            }
        } catch (JSONException ignored) {
            // corrupt store — treat as empty
        }
        return out;
    }

    public void save(List<ScheduledAlarm> alarms) {
        JSONArray arr = new JSONArray();
        for (ScheduledAlarm a : alarms) {
            try {
                arr.put(a.toJson());
            } catch (JSONException ignored) {
            }
        }
        prefs.edit().putString(KEY, arr.toString()).apply();
    }

    public void clear() {
        prefs.edit().remove(KEY).apply();
    }
}
