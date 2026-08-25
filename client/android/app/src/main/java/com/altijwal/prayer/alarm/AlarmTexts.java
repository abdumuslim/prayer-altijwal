package com.altijwal.prayer.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.UserManager;

import org.json.JSONObject;

/**
 * DE-persisted localized strings for the reliability notifications
 * (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §4). Native renders prebuilt localized
 * text (the established pattern), so JS passes a flat {@code texts} map on every
 * replaceAll; this store persists it and falls back to built-in Arabic constants
 * identical to the AR dict when the map was never synced (update-then-never-opened).
 *
 * <p>Stored in device-protected (DE) storage so a pre-unlock pre/missed/refresh
 * notice can still render (§3a/P2). {@code {prayer}} (the alarm's stored title)
 * and {@code {min}} are substituted in Java via {@link #substitute}.
 */
public final class AlarmTexts {
    private static final String PREFS = "prayer_alarm_texts";

    /** Shared DE marker file so each store migrates from credential storage once. */
    private static final String MIGRATION_PREFS = "prayer_de_migration";

    // Map keys — the bare camelCase field names of the JS `texts` record
    // (lib/native.ts AlarmTexts); also the SharedPreferences keys.
    private static final String KEY_PRE_TITLE = "preTitle";
    private static final String KEY_PRE_BODY = "preBody";
    private static final String KEY_PRE_ACTION = "preAction";
    private static final String KEY_PRE_STOPPED = "preStopped";
    private static final String KEY_MISSED_TITLE = "missedTitle";
    private static final String KEY_MISSED_RANG = "missedRang";
    private static final String KEY_MISSED_NOT_FIRED = "missedNotFired";
    private static final String KEY_REFRESH_TITLE = "refreshTitle";
    private static final String KEY_REFRESH_BODY = "refreshBody";

    private static final String[] KEYS = {
            KEY_PRE_TITLE, KEY_PRE_BODY, KEY_PRE_ACTION, KEY_PRE_STOPPED,
            KEY_MISSED_TITLE, KEY_MISSED_RANG, KEY_MISSED_NOT_FIRED,
            KEY_REFRESH_TITLE, KEY_REFRESH_BODY
    };

    // Built-in AR defaults — identical to the AR dict values (§4 table).
    private static final String DEF_PRE_TITLE = "سيرنّ منبّه {prayer} بعد {min} دقيقة";
    private static final String DEF_PRE_BODY = "إن كنت مستيقظًا فيمكنك إيقافه من هنا.";
    private static final String DEF_PRE_ACTION = "إيقاف المنبّه";
    private static final String DEF_PRE_STOPPED = "أُوقف منبّه {prayer}.";
    private static final String DEF_MISSED_TITLE = "فاتك منبّه {prayer}";
    private static final String DEF_MISSED_RANG = "رنّ المنبّه ولم يُوقَف.";
    private static final String DEF_MISSED_NOT_FIRED = "لم ينطلق المنبّه في وقته.";
    private static final String DEF_REFRESH_TITLE = "حدّث منبّهات الصلاة";
    private static final String DEF_REFRESH_BODY = "افتح التطبيق لتحديث مواعيد المنبّهات القادمة.";

    private final SharedPreferences prefs;

    public AlarmTexts(Context ctx) {
        this.prefs = devicePrefs(ctx, PREFS);
    }

    /** Persist the JS-supplied text map; empty/absent values keep the current text. */
    public void save(JSONObject texts) {
        if (texts == null) return;
        SharedPreferences.Editor e = prefs.edit();
        for (String key : KEYS) {
            String v = texts.optString(key, null);
            if (v != null && !v.isEmpty()) e.putString(key, v);
        }
        e.apply();
    }

    public String preTitle() {
        return get(KEY_PRE_TITLE, DEF_PRE_TITLE);
    }

    public String preBody() {
        return get(KEY_PRE_BODY, DEF_PRE_BODY);
    }

    public String preAction() {
        return get(KEY_PRE_ACTION, DEF_PRE_ACTION);
    }

    public String preStopped() {
        return get(KEY_PRE_STOPPED, DEF_PRE_STOPPED);
    }

    public String missedTitle() {
        return get(KEY_MISSED_TITLE, DEF_MISSED_TITLE);
    }

    public String missedRang() {
        return get(KEY_MISSED_RANG, DEF_MISSED_RANG);
    }

    public String missedNotFired() {
        return get(KEY_MISSED_NOT_FIRED, DEF_MISSED_NOT_FIRED);
    }

    public String refreshTitle() {
        return get(KEY_REFRESH_TITLE, DEF_REFRESH_TITLE);
    }

    public String refreshBody() {
        return get(KEY_REFRESH_BODY, DEF_REFRESH_BODY);
    }

    private String get(String key, String fallback) {
        String v = prefs.getString(key, null);
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    /** Replace {@code {prayer}} and (when non-null) {@code {min}} in a template. */
    public static String substitute(String template, String prayer, String min) {
        if (template == null) return "";
        String out = template.replace("{prayer}", prayer == null ? "" : prayer);
        if (min != null) out = out.replace("{min}", min);
        return out;
    }

    /**
     * Device-protected SharedPreferences so the texts are readable before first
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
