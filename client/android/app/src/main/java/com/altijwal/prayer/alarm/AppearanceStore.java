package com.altijwal.prayer.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

/**
 * Persists the active theme's alarm-screen palette (bg/ink/inkDim/accent) in
 * SharedPreferences so AlarmActivity can match the in-app theme even when the
 * alarm fires with the app killed (docs/V2_REDESIGN_SPEC.md Phase 7). Written
 * only by PrayerAlarmPlugin.setAppearance; every read parses defensively and
 * falls back to the night palette — bridge inputs are untrusted JS.
 */
public class AppearanceStore {
    private static final String PREFS = "prayer_appearance_store";
    private static final String KEY_BG = "bg";
    private static final String KEY_INK = "ink";
    private static final String KEY_INK_DIM = "inkDim";
    private static final String KEY_ACCENT = "accent";

    private final SharedPreferences prefs;

    public AppearanceStore(Context ctx) {
        this.prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Store the palette as raw strings; null clears a key (→ night fallback on read). */
    public void save(String bg, String ink, String inkDim, String accent) {
        SharedPreferences.Editor e = prefs.edit();
        put(e, KEY_BG, bg);
        put(e, KEY_INK, ink);
        put(e, KEY_INK_DIM, inkDim);
        put(e, KEY_ACCENT, accent);
        e.apply();
    }

    private static void put(SharedPreferences.Editor e, String key, String value) {
        if (value == null) e.remove(key);
        else e.putString(key, value);
    }

    public int bg(int fallback) {
        return color(KEY_BG, fallback);
    }

    public int ink(int fallback) {
        return color(KEY_INK, fallback);
    }

    public int inkDim(int fallback) {
        return color(KEY_INK_DIM, fallback);
    }

    public int accent(int fallback) {
        return color(KEY_ACCENT, fallback);
    }

    private int color(String key, int fallback) {
        String raw = prefs.getString(key, null);
        if (raw == null) return fallback;
        try {
            return Color.parseColor(raw);
        } catch (IllegalArgumentException ignored) {
            return fallback; // malformed color from the JS bridge — keep night
        }
    }
}
