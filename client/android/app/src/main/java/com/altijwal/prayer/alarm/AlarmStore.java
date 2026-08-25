package com.altijwal.prayer.alarm;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.UserManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Persists the currently-armed alarm set as JSON in SharedPreferences so
 * BootReceiver/AlarmRearm can re-arm everything after a reboot
 * (docs/NATIVE_ALARM_SPEC.md §3f). The scheduler/plugin are the writers.
 *
 * <p>Stored in device-protected (DE) storage so it is readable before the first
 * unlock on FBE devices, where the fire chain must still work
 * (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §3a/P2). It also keeps two meta keys —
 * {@code lastSyncHadAlarms}/{@code lastSyncAt} — written by the JS-driven
 * replaceAll so the horizon-refresh nag (§3e) knows the app once had alarms, and
 * a per-occurrence {@code dismissed} suppression map so an occurrence the user
 * turned off from its heads-up is never re-armed by a later JS resync (§2).
 *
 * <p>All alarm components share one process; every compound read-modify-write
 * runs under {@link #LOCK} so the receiver thread and the plugin thread can't
 * clobber each other's set, and writes use {@code commit()} so the store reaches
 * disk before alarms are armed.
 */
public class AlarmStore {
    private static final String TAG = "PrayerAlarm";
    private static final String PREFS = "prayer_alarm_store";
    private static final String KEY = "alarms";
    private static final String KEY_LAST_HAD = "lastSyncHadAlarms";
    private static final String KEY_LAST_AT = "lastSyncAt";
    private static final String KEY_DISMISSED = "dismissed"; // id → occurrence `at` (epoch ms)
    private static final String KEY_MISSED_INVARIANT = "missedInvariantV1"; // set once this 2.5 build writes the store

    /** Shared DE marker file so each store migrates from credential storage once. */
    private static final String MIGRATION_PREFS = "prayer_de_migration";

    /** Serializes compound RMW across the receiver/plugin threads (one process). */
    private static final Object LOCK = new Object();

    private final SharedPreferences prefs;

    public AlarmStore(Context ctx) {
        this.prefs = devicePrefs(ctx, PREFS);
    }

    /**
     * The store lock, exposed so a caller can run a multi-call sequence
     * (cancel → save → arm) as one transaction against the fire receiver's
     * {@link #removeById} (§ finding 1). Reentrant, so the store's own
     * synchronized methods nest fine inside {@code synchronized (lock())}.
     */
    static Object lock() {
        return LOCK;
    }

    public List<ScheduledAlarm> load() {
        synchronized (LOCK) {
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
    }

    public void save(List<ScheduledAlarm> alarms) {
        JSONArray arr = new JSONArray();
        for (ScheduledAlarm a : alarms) {
            try {
                arr.put(a.toJson());
            } catch (JSONException ignored) {
            }
        }
        synchronized (LOCK) {
            commit(prefs.edit().putString(KEY, arr.toString()));
        }
    }

    /** Drop one entry by id (AlarmReceiver on every fire; the dismiss path). */
    public void removeById(String id) {
        if (id == null) return;
        synchronized (LOCK) {
            List<ScheduledAlarm> kept = new ArrayList<>();
            for (ScheduledAlarm a : load()) { // reentrant lock
                if (!id.equals(a.id)) kept.add(a);
            }
            save(kept);
        }
    }

    /** Meta written by replaceAll so the §3e refresh nag can tell alarms once existed. */
    public void setSyncMeta(boolean hadAlarms, long at) {
        synchronized (LOCK) {
            commit(prefs.edit().putBoolean(KEY_LAST_HAD, hadAlarms).putLong(KEY_LAST_AT, at));
        }
    }

    public boolean lastSyncHadAlarms() {
        synchronized (LOCK) {
            return prefs.getBoolean(KEY_LAST_HAD, false);
        }
    }

    public long lastSyncAt() {
        synchronized (LOCK) {
            return prefs.getLong(KEY_LAST_AT, 0L);
        }
    }

    public void clear() {
        // Also drop dismiss suppressions: cancelAll = the user disabled everything,
        // so a stale suppression must not outlive that (§ finding 2). The one-time
        // missed-invariant marker deliberately persists — it is a version fact.
        synchronized (LOCK) {
            commit(prefs.edit().remove(KEY).remove(KEY_LAST_HAD).remove(KEY_LAST_AT).remove(KEY_DISMISSED));
        }
    }

    // ── one-time missed-invariant marker (§ finding 4) ───────────────────────

    /** True once this build has written the store — only then does "past entry in
     *  the store ⇒ it never fired" hold (a 2.4 receiver never removed fired ids). */
    public boolean missedInvariantEstablished() {
        synchronized (LOCK) {
            return prefs.getBoolean(KEY_MISSED_INVARIANT, false);
        }
    }

    public void establishMissedInvariant() {
        synchronized (LOCK) {
            commit(prefs.edit().putBoolean(KEY_MISSED_INVARIANT, true));
        }
    }

    // ── per-occurrence dismiss suppression (§2) ──────────────────────────────

    /** Suppress one occurrence (by fire id) so a later resync can't re-arm it. */
    public void addDismissed(String id, long at) {
        if (id == null) return;
        synchronized (LOCK) {
            JSONObject map = loadDismissed();
            try {
                map.put(id, at);
            } catch (JSONException ignored) {
            }
            commit(prefs.edit().putString(KEY_DISMISSED, map.toString()));
        }
    }

    /**
     * Suppressed only when the map holds this id AND the stored instant equals the
     * candidate's exactly. Rule ids are reused after delete+recreate (JS nextId =
     * max+1), so matching the occurrence instant lets a recreated rule with new
     * timing ring while still muting the exact occurrence the user turned off (§2).
     */
    public boolean isDismissed(String id, long at) {
        if (id == null) return false;
        synchronized (LOCK) {
            JSONObject map = loadDismissed();
            return map.has(id) && map.optLong(id) == at;
        }
    }

    /**
     * Keep only the dismiss suppressions whose id is in {@code ids} (the id set of
     * the current incoming sync). A suppression whose occurrence no longer arrives
     * from JS refers to a deleted rule and must not outlive it: recreating that rule
     * (reused id + identical instant) before the occurrence passes would otherwise be
     * silently muted (§ finding 3). An empty set clears the whole map (the empty-sync
     * "deleted the last rule" case).
     */
    public void retainDismissed(Set<String> ids) {
        synchronized (LOCK) {
            JSONObject map = loadDismissed();
            JSONObject kept = new JSONObject();
            boolean changed = false;
            Iterator<String> keys = map.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (ids != null && ids.contains(k)) {
                    try {
                        kept.put(k, map.optLong(k));
                    } catch (JSONException ignored) {
                    }
                } else {
                    changed = true; // suppression for a rule the sync no longer contains — drop it
                }
            }
            if (changed) commit(prefs.edit().putString(KEY_DISMISSED, kept.toString()));
        }
    }

    /** Read the map, pruning (and persisting) any entries whose instant has passed. */
    private JSONObject loadDismissed() {
        // caller holds LOCK
        JSONObject out = new JSONObject();
        String raw = prefs.getString(KEY_DISMISSED, null);
        if (raw == null) return out;
        long now = System.currentTimeMillis();
        boolean pruned = false;
        try {
            JSONObject src = new JSONObject(raw);
            Iterator<String> keys = src.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                long at = src.optLong(k);
                if (at > now) {
                    try {
                        out.put(k, at);
                    } catch (JSONException ignored) {
                    }
                } else {
                    pruned = true; // occurrence has passed — drop it
                }
            }
        } catch (JSONException ignored) {
            return new JSONObject(); // corrupt — treat as empty
        }
        if (pruned) {
            commit(prefs.edit().putString(KEY_DISMISSED, out.toString()));
        }
        return out;
    }

    private static void commit(SharedPreferences.Editor e) {
        if (!e.commit()) {
            Log.e(TAG, "prefs commit failed");
        }
    }

    /**
     * Device-protected SharedPreferences so the store is readable before first
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
