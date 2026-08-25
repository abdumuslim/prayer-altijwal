---
type: Spec
title: 'Native Alarm Reliability Round: missed-alarm notice, pre-alarm dismiss, not-firing fixes'
description: 'Two user-requested features (missed-alarm notification; a 30-min-before notification with a turn-off button) plus the full not-firing audit fixes: direct-boot chain, exact-alarm fallback SecurityException, per-alarm fault isolation, store ordering, daily maintenance canary, horizon-refresh nag.'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-08-25
---

# Native Alarm Reliability Round (v2.5.0)

> Read `docs/NATIVE_ALARM_SPEC.md` (as-built architecture) and `docs/NATIVE_ALARM_FIXES_SPEC.md`
> (prior fix round) first. This round was driven by tester feedback ("alarm didn't fire") and a
> 4-agent audit (2 platform researchers + 2 code sweepers, 2026-08-25). All platform claims below
> were verified against developer.android.com / AOSP source during that audit.

## 0. Audit conclusions the design rests on

| # | Verified fact | Consequence |
|---|---|---|
| P1 | Non-`directBootAware` components are **completely inert before first unlock** (FBE). An AlarmManager PendingIntent broadcast to a non-DBA receiver pre-unlock is silently dropped. `LOCKED_BOOT_COMPLETED` goes only to DBA components; `BOOT_COMPLETED` is delivered **after first unlock** on FBE devices. | The whole fire chain (receiver→service→activity) and the boot receiver must be DBA; stores must live in device-protected (DE) storage. |
| P2 | Credential-protected SharedPreferences access pre-unlock throws `IllegalStateException`. Migration API: `deviceProtectedContext.moveSharedPreferencesFrom(defaultContext, name)`. | `AlarmStore` + `AppearanceStore` (+ the new texts store) move to DE storage with an idempotent migration. |
| P3 | Revoking «المنبهات والتذكيرات» (SCHEDULE_EXACT_ALARM) **deletes all** armed `setExact`/`setExactAndAllowWhileIdle`/`setAlarmClock` alarms; the `ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` broadcast fires **on grant only**, never on revoke. Plain `set`/`setAndAllowWhileIdle` alarms survive. | Re-arm on the grant broadcast; use an **inexact daily canary** (survives revocation) to detect/repair the revoke case. |
| P4 | On API 31+, `setExactAndAllowWhileIdle` **throws `SecurityException` without the exact-alarm grant**. The current fallback branch calls exactly that ⇒ with permission absent, every arm attempt throws, the whole `replaceAll` aborts, **zero alarms armed**. Play may strip `USE_EXACT_ALARM` from non-clock apps, so `canScheduleExactAlarms()` can be false in production even though the manifest declares both permissions. | This is a prime candidate for the tester report. Correct fallback is inexact `setAndAllowWhileIdle`. |
| P5 | A normal app update preserves armed alarms on stock AOSP (`EXTRA_REPLACING` short-circuit). Force-stop deletes them, and Android 15+ additionally cancels the app's PendingIntents in stopped state; no broadcast reaches a stopped app until relaunch. Samsung "sleeping apps" (~3 days unopened) behaves like force-stop and is not programmatically exemptible. | Unfixable in code beyond what exists; mitigated by the canary + refresh nag + (already-shipped) battery-exemption onboarding. Documented limitation. |
| P6 | ~500 alarms per UID hard cap; exceeding throws synchronously from the scheduling call. | Cap armed set, nearest-first, with per-alarm fault isolation. |
| P7 | Notification action button → `PendingIntent.getBroadcast` doing non-UI work is unaffected by Android 12+ trampoline rules. FSI degrade (permission revoked) = 60-s heads-up, tone unaffected. `POST_NOTIFICATIONS` denied: FGS + audio still run; notification (and in all likelihood the FSI launch) suppressed. | The pre-alarm dismiss button design is safe. FSI/notification degradation is surfaced by the existing permission rows; no new code. |
| P8 | Pre-unlock, APK-asset tones always play; `content://` device tones and the system default-alarm URI may not resolve (CE-backed providers). | Tone fallback order at fire time: chosen source → **bundled default asset** → system default URI (last, guarded). |

## 1. Feature A: missed-alarm notification (user request)

**Rule: an alarm-kind fire that ends without the user stopping it produces a «missed» notification.**
Three paths funnel into it:

1. **Rang out**; `AlarmService` ring ended via the 2-min cap or `onTimeout`, not via `ACTION_STOP`
   (user actions: notification Stop button, AlarmActivity swipe/tap; both send `ACTION_STOP`).
   `stopEverything()` gains a `missed` boolean; the timeout paths pass `true`, `ACTION_STOP` passes
   `false`, `onDestroy` cleanup passes `false`. Body: `missedRang`.
2. **Stale skip**; `AlarmReceiver`'s >5-min stale guard drops an alarm-kind fire. Body: `missedNotFired`.
3. **Never fired (phone off / permission loss)**; resync-from-store (boot, canary, grant broadcast)
   prunes a **past alarm-kind entry still present in the store**. Invariant making this sound:
   **`AlarmReceiver` removes the fired id from `AlarmStore` on every fire (both kinds)**; so a past
   alarm-kind entry still in the store at resync time provably never fired. Body: `missedNotFired`.

Posting: `REMINDER` channel, single fixed notification id (latest missed wins), title
`missedTitle` with `{prayer}` ← the alarm's stored `title` (already the localized prayer name),
content intent = app launch (same pattern as `postReminder`), auto-cancel. Guarded
`SecurityException` catch like the existing reminder path.

## 2. Feature B: pre-alarm dismiss notification (user request)

**Rule: every armed alarm-kind instant also arms a quiet notification 30 min earlier with an
«إيقاف المنبّه» action that cancels that one occurrence without opening the app.**

- **Arming** (in `AlarmScheduler`, alongside each alarm-kind fire PI): inexact
  `setAndAllowWhileIdle(RTC_WAKEUP, at − 30 min, prePi)`; inexact is deliberate (survives
  permission revocation per P3, needs no exact grant per P4; ±minutes accuracy is fine for a
  heads-up). `prePi` = broadcast to `AlarmReceiver`, action `com.altijwal.prayer.PRE_ALARM`, data
  URI `prayeralarm-pre://<id>`, requestCode `id.hashCode() ^ 0x3333`, same extras. Skip when
  `at − 30 min ≤ now + 60 s`. `cancel(a)` cancels the pre-PI too.
- **Pre-fire** (`AlarmReceiver`, `PRE_ALARM` action): re-check the store; if the id is gone
  (rule deleted / re-synced away), do nothing. Else post on the **new silent channel**
  `prayer_prealarm_v1` (IMPORTANCE_DEFAULT, `setSound(null)`, vibration off; visible on the lock
  screen without waking anyone): title `preTitle` with `{prayer}` and `{min}` ← rounded
  `(at − now)/60000`; body `preBody`; content intent = app launch; action button `preAction` →
  `PendingIntent.getBroadcast` to `AlarmReceiver` action `com.altijwal.prayer.DISMISS_UPCOMING`,
  data `prayeralarm-dismiss://<id>` (P7: safe). Notification id derived from the alarm id.
- **Dismiss** (`DISMISS_UPCOMING`): cancel the fire PI + pre PI for that id, remove the id from the
  store (so boot/canary resync cannot resurrect it and no missed notice is produced), record the id
  in a **persisted per-occurrence suppression map** (`dismissed` id→at in the store, pruned once the
  instant passes) that `replaceAll` and every resync consult; otherwise the next JS sync recomputes
  the same occurrence id from the unchanged rule and re-arms an alarm the user explicitly turned off
  (Codex P1, 2026-08-25); cancel the pre-notification, and post a short auto-cancel confirmation
  (`preStopped`, `setTimeoutAfter` ~15 s) on the same channel/id. The dismiss mutation runs as one
  transaction under the store lock, suppression recorded first (round 3). **Suppression matches id
  AND the exact instant** (rule ids are reused after delete+recreate, so id-only matching could mute a newly
  created rule; same instant = same occurrence, a different instant must ring). Staleness is pruned
  on every `replaceAll`: the map retains only ids present in the incoming set (a dismissed
  occurrence that no longer arrives from JS belonged to a deleted rule and must not mute a
  recreated one; subsumes the empty-sync clear), and `cancelAll` clears it (Codex rounds 2-4).
- **On real fire** of id X (`FIRE_ALARM`): cancel X's pre-notification if still showing.
- Notification-kind rules get no pre-alarm.

## 3. Not-firing fixes

### 3a. Direct-boot chain (P1/P2/P8)
- `android:directBootAware="true"` on: `BootReceiver`, `AlarmReceiver`, `AlarmService`,
  `AlarmActivity` (manifest).
- `AlarmStore`, `AppearanceStore`, and the new `AlarmTexts` store construct their prefs from
  `createDeviceProtectedStorageContext()` (minSdk 24 ⇒ no guard). One-time idempotent migration
  (`moveSharedPreferencesFrom` from the credential context) wrapped in try/catch: it runs wherever a
  store is constructed **post-unlock** (`UserManager.isUserUnlocked()` guard; pre-unlock constructors
  skip migration and read whatever DE already has). Known one-release transitional gap: a device that
  auto-updates, never opens the app, then reboots and rings pre-unlock still misses (CE data not yet
  migrated); heals at `BOOT_COMPLETED` (post-unlock) via resync; document, don't chase.
- Tone order in `AlarmService.startTone` (P8): chosen tone (asset or `content://`, each guarded) →
  **bundled default asset** (`adhan-makkah` or the first bundled tone; implementer: use the same
  default id JS uses in `lib/alarm-sounds`) → `RingtoneManager.getDefaultUri(TYPE_ALARM)` (guarded)
  → silent (vibration still runs). Today the unconditional default-URI fallback can throw
  pre-unlock and leave a **silent ring**.

### 3b. Exact-alarm fallback + fault isolation + cap (P3/P4/P6)
`AlarmScheduler`:
- Fallback branch: when `canScheduleExact()` is false → `setAndAllowWhileIdle` (inexact; never the
  API 31+-throwing `setExactAndAllowWhileIdle`). Delete the dead pre-M `setExact` branch (minSdk 24).
- **Fire-side degrade for that branch (Codex P1, 2026-08-25):** an inexact-alarm broadcast has no
  FGS-background-start exemption (only the exact family does), so `AlarmReceiver` guards
  `startForegroundService` and degrades to the default-sound reminder notification when the start is
  refused; the user is still alerted once instead of getting silence.
- `schedule(a)` wrapped so one failure never aborts a batch; `scheduleAll` counts failures and
  `Log.e`s a summary (tag `PrayerAlarm`, greppable in logcat).
- Cap: fire alarms nearest-first up to **440**; pre-alarms for armed fire alarms nearest-first while
  total ≤ **490**; canary always. Log dropped count (no silent cap).

### 3c. `replaceAll` ordering (orphan window)
`PrayerAlarmPlugin.replaceAll`: load old → `cancelAll(old)` (also cancels pre-PIs and any visible
pre-notifications) → **`store.save(next)` before arming** → `scheduleAll(next)`. A crash between
save and arm now self-heals at the next resync (store is authoritative); the old order could orphan
an armed set the app could never cancel. Store writes use synchronous `commit()` (durable before
arming) and every compound load-modify-save is serialized on one in-process lock; the fire
receiver's `removeById` runs concurrently with plugin-thread syncs (Codex P2 ×2, 2026-08-25).
Round 2 tightened this further (Codex P1): the WHOLE replacement/resync (load → cancel → save →
arm) runs inside one `synchronized (AlarmStore.lock())` transaction so a fire-side `removeById`
cannot interleave and resurrect a fired id, and the arm loop skips (but keeps stored, for the
missed logic) any instant that slipped into the past between compute and arm; arming a just-past
`setAlarmClock` fires immediately, a duplicate-ring window.

### 3d. One resync path + new triggers (P3/P5)
- Extract `resyncFromStore(Context)` (new small class `AlarmRearm`): load store → partition
  past/future → missed notices for past alarm-kind entries (§1.3) → prune → cancel+re-arm future
  (fire + pre) with the §3b isolation/cap → save → re-arm the canary → horizon check (§3e).
- `BootReceiver` (keep name; it is now the generic resync receiver) delegates to it and adds intent
  filters: existing three + `android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`
  (grant-side re-arm, P3) + the app-internal canary action `com.altijwal.prayer.MAINTENANCE`.
- **Daily canary**: every `replaceAll`/resync arms one inexact
  `setAndAllowWhileIdle(now + 24 h)` → `BootReceiver`/`MAINTENANCE` → `resyncFromStore`. Survives
  exact-permission revocation (P3), so a revoke is detected and the set re-armed (inexact) within
  ~24 h, and the horizon nag below has a pulse even when the app isn't opened. Dies with force-stop /
  Samsung app sleep (P5); documented limit.

### 3e. Horizon-refresh nag
The JS horizon is 7 days and tops up only when the app opens. At every resync/canary tick: if the
store's last sync had alarms (`AlarmStore` gains `lastSyncHadAlarms` + `lastSyncAt` meta) and the
remaining future set is empty or ends < 48 h away → post a notification on the **silent `PREALARM`
channel** (`refreshTitle`/`refreshBody`, fixed id, content intent = app launch); the canary can
tick at any hour, so the nag must never be audible (Codex P2, 2026-08-25). Opening the app re-syncs
7 fresh days and the nag disappears. **Upgrade bootstrap (round 2, P1):** a store migrated from
2.4 has alarms but no meta (only the 2.5 `replaceAll` writes it), so `resyncFromStore` initializes
`setSyncMeta(true, now)` when the loaded set is non-empty and `lastSyncAt == 0`; without this the
nag never fires for exactly the update-then-never-opened users it exists for. **Missed-invariant
marker (round 2, P2):** the §1.3 "past entry ⇒ never fired" invariant only holds for stores THIS
version has written (2.4 never removed fired ids), so the first resync after the update prunes past
entries silently and sets a one-time marker; only later resyncs post missed notices.

### 3f. JS layer hardening (sweep findings)
`client/src/native/schedule.ts`:
- Per-day try/catch around `anchorsForDay` (one bad day drops that day, not the whole horizon);
  `Number.isFinite(anchor)` guard (NaN passed both existing filters).
- DST-safe day iteration: derive day d's date key by **civil-date string arithmetic** (parse
  `YYYY-MM-DD`, add d days via `Date.UTC`), not `dateKeyIn(now + d*DAY_MS)` which skips
  spring-forward days / duplicates fall-back days in DST timezones.
`client/src/hooks/useNativeAlarmScheduler.ts`:
- Generation token (`useRef` counter) checked after every await; a stale in-flight `replaceAll`
  must not overwrite a newer one (today `cancelled` is checked once, before the native call).
- One retry ~5 s after a failed `replaceAll` (same generation only). Native `replaceAll` rejects
  the call when any arm attempt failed (round 4), so stored-but-unarmed occurrences reach this
  retry instead of being reported as success.
- 6-hourly interval nonce bump while the app stays foregrounded (today only resume re-syncs).

## 4. Text plumbing (`texts`); the only new strings

Native renders prebuilt localized text (established pattern). JS passes a `texts` map on every
`replaceAll`; Java persists it in DE prefs (`AlarmTexts`) and falls back to **built-in AR constants
identical to the AR dict values** when the map was never synced (update-then-never-opened case).
Placeholders `{prayer}` (the alarm's stored `title`) and `{min}` are substituted in Java.

| key | AR (authoritative) | EN |
|---|---|---|
| `alarm.preTitle` | `سيرنّ منبّه {prayer} بعد {min} دقيقة` | `{prayer} alarm rings in {min} min` |
| `alarm.preBody` | `إن كنت مستيقظًا فيمكنك إيقافه من هنا.` | `Awake? You can turn it off from here.` |
| `alarm.preAction` | `إيقاف المنبّه` | `Turn off alarm` |
| `alarm.preStopped` | `أُوقف منبّه {prayer}.` | `{prayer} alarm turned off.` |
| `alarm.missedTitle` | `فاتك منبّه {prayer}` | `Missed {prayer} alarm` |
| `alarm.missedRang` | `رنّ المنبّه ولم يُوقَف.` | `The alarm rang and wasn't stopped.` |
| `alarm.missedNotFired` | `لم ينطلق المنبّه في وقته.` | `The alarm couldn't ring on time.` |
| `alarm.refreshTitle` | `حدّث منبّهات الصلاة` | `Refresh prayer alarms` |
| `alarm.refreshBody` | `افتح التطبيق لتحديث مواعيد المنبّهات القادمة.` | `Open the app to refresh upcoming alarms.` |

⚠ New user-visible strings shipped under the owner's explicit feature+ship order (2026-08-25);
flagged for his post-hoc review in the session report. New channel `prayer_prealarm_v1` gets the
English system-settings name "Upcoming prayer alarms" (existing channels are English there too).

TS contract (`lib/native.ts`): `replaceAll(options: { alarms: ScheduledAlarm[]; texts?: AlarmTexts })`
with `AlarmTexts` = the nine keys above as a flat `Record`. `useNativeAlarmScheduler` builds it from
the i18n dicts each sync.

## 5. File-change checklist

| File | Change | § |
|---|---|---|
| `AndroidManifest.xml` | DBA on the four components; `BootReceiver` filter additions | 3a/3d |
| `alarm/AlarmStore.java` | DE storage + migration; `lastSyncHadAlarms`/`lastSyncAt`; `removeById` | 3a/3e/1 |
| `alarm/AppearanceStore.java` | DE storage + migration | 3a |
| `alarm/AlarmTexts.java` | **NEW**; DE-persisted texts + AR defaults + templating | 4 |
| `alarm/AlarmScheduler.java` | fallback fix, per-alarm isolation, cap, pre-PI arm/cancel, canary arm | 3b/2/3d |
| `alarm/AlarmReceiver.java` | fire-id store removal; stale→missed; `PRE_ALARM`/`DISMISS_UPCOMING`; pre-notification cancel on fire | 1/2 |
| `alarm/AlarmService.java` | `stopEverything(missed)`; missed notice on ring-out; release-before-new `MediaPlayer` (overlap leak); tone fallback order | 1/3a |
| `alarm/AlarmRearm.java` | **NEW**; `resyncFromStore` + missed-on-prune + horizon nag | 3d/3e/1 |
| `alarm/BootReceiver.java` | delegate to `AlarmRearm`; new actions | 3d |
| `alarm/AlarmChannels.java` | `PREALARM` channel | 2 |
| `alarm/PrayerAlarmPlugin.java` | `replaceAll` ordering + `texts` parsing | 3c/4 |
| `client/src/lib/native.ts` | `AlarmTexts` type; `replaceAll` signature | 4 |
| `client/src/native/schedule.ts` | per-day try/catch; finite guard; DST-safe day keys | 3f |
| `client/src/hooks/useNativeAlarmScheduler.ts` | generation token; retry; interval nonce; pass `texts` | 3f/4 |
| `client/src/i18n/strings.ar.ts` + `strings.en.ts` | the nine `alarm.*` keys | 4 |
| `client/src/native/schedule.test.ts` | DST day-iteration + NaN-guard tests | 3f |
| `docs/NATIVE_ALARM_SPEC.md`, `CHANGELOG.md` | as-built delta + 2.5.0 entry |; |

**Out of scope (documented, deliberate):** Samsung app-sleep / force-stop recovery (P5; impossible
in code); `migrateRemoveSeededDefault` shape-matching (already shipped, one-shot key consumed); DND
bypass policy access; `localMidnightMs` 1-h DST sampling skew (window selection only, no alarm drop).

## 6. Acceptance

Commands (all green): `cd client && npm run build && npm test` · `cd server && npm test` ·
`npx cap sync android` · `cd client/android && .\gradlew.bat assembleDebug` ·
`findstr /m astronomy client\dist\assets\*.js` → only the lazy native chunk.

Emulator (`prayer36`): ① pre-alarm notification appears ~30 min before an armed alarm; its button
cancels that occurrence (store pruned, `dumpsys alarm` shows the fire PI gone, confirmation shown,
alarm does not ring); ② an alarm left ringing 2 min produces the missed notification; Stop/swipe
does not; ③ `adb reboot` with a device PIN set: `BootReceiver` re-arms **before unlock** (logcat)
and a pre-unlock fire rings; ④ revoke «المنبهات والتذكيرات» → alarms re-armed inexact (no
`SecurityException` batch abort), re-grant broadcast re-arms exact; ⑤ `adb install -r` keeps the set
armed; ⑥ canary alarm visible in `dumpsys alarm`; horizon nag fires when the store is emptied of
future instants while `lastSyncHadAlarms`.
