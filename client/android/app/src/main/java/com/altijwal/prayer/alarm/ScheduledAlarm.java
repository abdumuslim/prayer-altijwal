package com.altijwal.prayer.alarm;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * One on-device scheduled alarm instant, mirroring the JS ScheduledAlarm
 * (client/src/lib/native.ts). Serialized to JSON for SharedPreferences so it
 * survives reboot (see AlarmStore + BootReceiver).
 */
public class ScheduledAlarm {
    public final String id;
    public final long at;          // epoch ms
    public final String kind;      // "alarm" | "notification"
    public final String title;
    public final String body;
    public final String toneId;    // AlarmSound id (alarm kind only)
    public final String target;    // AlertTarget, for the ?alarm= deep link

    public ScheduledAlarm(String id, long at, String kind, String title, String body, String toneId, String target) {
        this.id = id;
        this.at = at;
        this.kind = kind;
        this.title = title;
        this.body = body;
        this.toneId = toneId;
        this.target = target;
    }

    public boolean isAlarm() {
        return "alarm".equals(kind);
    }

    public JSONObject toJson() throws JSONException {
        JSONObject o = new JSONObject();
        o.put("id", id);
        o.put("at", at);
        o.put("kind", kind);
        o.put("title", title);
        o.put("body", body);
        o.put("toneId", toneId);
        o.put("target", target);
        return o;
    }

    public static ScheduledAlarm fromJson(JSONObject o) {
        return new ScheduledAlarm(
                o.optString("id"),
                o.optLong("at"),
                o.optString("kind", "notification"),
                o.optString("title"),
                o.optString("body"),
                o.optString("toneId"),
                o.optString("target"));
    }

    /** Stable per-alarm request code for the PendingIntent (id is unique per fire). */
    public int requestCode() {
        return id.hashCode();
    }
}
