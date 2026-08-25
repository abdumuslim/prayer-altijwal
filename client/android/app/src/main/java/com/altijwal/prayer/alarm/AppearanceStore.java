package com.altijwal.prayer.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.UserManager;

/**
 * Persists the active theme's alarm-screen palette (bg/ink/inkDim/accent) in
 * SharedPreferences so AlarmActivity can match the in-app theme even when the
 * alarm fires with the app killed (docs/V2_REDESIGN_SPEC.md Phase 7). Written
 * only by PrayerAlarmPlugin.setAppearance; every read parses defensively and
 * falls back to the night palette — bridge inputs are untrusted JS.
 *
 * <p>Stored in device-protected (DE) storage so AlarmActivity can theme a
 * pre-unlock ring (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3a/P2).
 */
public class AppearanceStore {
    private static final String PREFS = "prayer_appearance_store";
    private static final String KEY_BG = "bg";
    private static final String KEY_INK = "ink";
    private static final String KEY_INK_DIM = "inkDim";
    private static final String KEY_ACCENT = "accent";

    /** Shared DE marker file so each store migrates from credential storage once. */
    private static final String MIGRATION_PREFS = "prayer_de_migration";

    private final SharedPreferences prefs;

    public AppearanceStore(Context ctx) {
        this.prefs = devicePrefs(ctx, PREFS);
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

    /**
     * Device-protected SharedPreferences so the palette is readable before first
     * unlock (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3a/P2). The one-time move
     * from credential storage runs only post-unlock (a pre-unlock CE access
     * throws) and is guarded by a per-name marker in a separate DE file, so the
     * target prefs are never opened before the move (which would cache stale
     * state). A failed move must never crash a receiver — hence the broad catch.
     */
    private static SharedPreferences devicePrefs(Context ctx, String name) {
        Context app = ctx.getApplicationContext();
        Context de = app.createDeviceProtectedStorageContext();
        UserManager um = (UserManager) app.getSystemService(Context.USER_SERVICE);
        if (um == null || um.isUserUnlocked()) {
            SharedPreferences marks = de.getSharedPreferences(MIGRATION_PREFS, Context.MODE_PRIVATE);
            if (!marks.getBoolean(name, false)) {
                // moveSharedPreferencesFrom returns false (it does not always throw) on
                // a genuine copy failure; mark migrated ONLY on success so a failure
                // stays retryable — else a post-unlock read is stuck on empty DE prefs
                // forever (§ finding 4). It returns true when the source never existed,
                // so fresh installs still mark on first run.
                boolean ok = false;
                try {
                    ok = de.moveSharedPreferencesFrom(app, name);
                } catch (Exception e) {
                    ok = false;
                }
                if (ok) marks.edit().putBoolean(name, true).apply();
            }
        }
        return de.getSharedPreferences(name, Context.MODE_PRIVATE);
    }
}
