# Native Alarm Spec (Capacitor, offline-first) — Android first, iOS deferred

> **Status: Phases 1–5 BUILT + VERIFIED (2026-07-11); on-device firing VERIFIED on the emulator the
> same day after a fix round** — see `docs/NATIVE_ALARM_FIXES_SPEC.md` (shared rules store, hardware
> back, AlarmActivity web-overlay design + countdown-to-adhan, brand launcher icon; all reproduced,
> fixed, and re-verified on the `prayer36` AVD). **Remaining:** Phase 6 (Play release — needs Google
> account/keystore; Play Console field list prepared) and Phase B (iOS AlarmKit). Supersedes the exploratory
> `NATIVE_ALARM_PLAN.md` (which now holds the research + vehicle verdict). Execute phase-by-phase;
> each phase ends with commands that must pass. Read `NOTIFICATIONS.md` (rule model + push),
> `PRAYER_ENGINE.md` (engine + Iraqi calibration), `PRAYER_TIMES_API.md` (payload shape),
> `FRONTEND.md` (web alarm UI) first. Research basis (AlarmKit, Android/Play policy, plugin survey):
> `NATIVE_ALARM_PLAN.md`.

## 1. Goal

Ship a real prayer alarm that rings the user's chosen tone at the exact prayer instant, full-screen
over the lock screen, **while the app is closed and the phone has no connectivity** — like the OS
clock app — by wrapping the existing React SPA (`client/`) in **Capacitor 8** and adding one small
app-local native plugin (`PrayerAlarm`). After a one-time online setup (choosing a location) the
native app is **fully self-sufficient**: it computes prayer times on-device with the same engine +
per-governorate Iraqi calibration the server uses (exact parity, proven by test), renders them
offline, and keeps a rolling ~7-day horizon of OS-level alarms armed (Android
`AlarmManager.setAlarmClock()` now; iOS 26 AlarmKit in a later phase). The web app, server, and live
site at https://prayer.altijwal.com remain byte-for-byte unaffected.

## 2. Decisions already made — do NOT reopen

| # | Decision |
|---|---|
| D1 | Vehicle: **Capacitor 8** shell around the unchanged `client/` build. No RN/Flutter/TWA (see plan doc for why each loses). |
| D2 | **Android first** (Play Store, $25 one-time). iOS is **Phase B — deferred** (no Mac / no Apple account yet; cloud CI + AlarmKit later). |
| D3 | **Offline-first**: the native app computes times ON-DEVICE via the reused engine + wrappers. Network is used only for location setup/change (geo endpoints) — never for times or alarms. Native has ONE times path: always local compute, even when online (so the offline path is always exercised). |
| D4 | In the native app, alert rules live in **localStorage** (`prayer.alerts.v1`) — Web Push doesn't exist in the Android WebView, so the push-endpoint key is unavailable; no server rules ⇒ no native/web-push double-alert. Rule shape is identical to the server `AlertRule`. |
| D5 | The plugin is **app-local Kotlin** in `client/android/` (registered in `MainActivity`) — NOT a separate npm package, NOT `@capacitor/local-notifications`, NOT any community plugin (all unusable — plan doc §plugins). |
| D6 | The ringing screen is a **thin native `AlarmActivity`** (huge clock, prayer name, stop) — not a webview route. The web `AlarmOverlay` still handles the in-app (foreground) case. **v2 P7 (2026-07-14): the screen follows the active THEME** — `setAppearance` persists the theme's `alarm:{bg,ink,inkDim,accent}` palette to `AppearanceStore` (SharedPreferences) and the activity builds from it, falling back to the original night look (`docs/V2_REDESIGN_SPEC.md` P7 notes). |
| D7 | Tones play via a **foreground-service `MediaPlayer` loop (2 min)**, `USAGE_ALARM` audio attributes, reading the MP3s Capacitor already bundles at `assets/public/alarms/`. The alarm notification channel is soundless (service owns the sound). |
| D8 | `kind:'notification'` rules also fire natively (plain notification at the instant, default-sound channel) — native users lose nothing by having no web push. |
| D9 | Exact-alarm permission: request **`SCHEDULE_EXACT_ALARM`** via the settings prompt (policy-safe). Also declare `USE_EXACT_ALARM` + file the Play alarm declaration — if accepted, users skip the prompt; if not, nothing breaks. |
| D10 | All fire instants are **epoch ms**; native code does zero timezone math (hard rule 4 — the engine computes with the stored location's IANA tz). |
| D11 | **Engine stays verbatim** (hard rule 2): the client imports `server/src/prayer-engine/**` and the other `server/src/prayer/*` wrappers UNCHANGED via path alias. The two Node-only spots are shimmed by Vite, not by editing sources: the engine's `astro.ts` `createRequire("node:module")` and `iraq-calibration.ts`'s `readFileSync`. |
| D12 | Scheduling horizon: **7 days** on Android (no OS alarm cap). Re-synced on launch / resume / location / rule / tone change. iOS Phase B: 2–3 days + the 64-notification-cap fallback path. |

## 3. Architecture & system changes

```
┌────────────────────────── Android app (client/android/) ──────────────────────────┐
│ WebView: the SAME React SPA + a native-only LAZY chunk (dynamic import):           │
│   engine (verbatim) + wrappers (compute/payload/hijri/events/format/method-detect) │
│   + iraq-calibration-browser (ESM JSON) → buildPrayerTimesPayload locally          │
│   usePrayerTimes(native) → local-times.ts  → UI works fully offline                │
│   useNativeAlarmScheduler: local rules × 7-day locally-computed anchor table       │
│     → PrayerAlarm.replaceAll({ alarms:[{id, at, kind, title, body, toneId}…] })    │
│                                                                                    │
│ PrayerAlarm plugin (Kotlin, app-local)                                             │
│   AlarmStore (SharedPreferences JSON — survives reboot)                            │
│   AlarmScheduler → AlarmManager.setAlarmClock() per instant                        │
│   AlarmReceiver ─kind=alarm──▶ AlarmService (FGS mediaPlayback: MediaPlayer loop   │
│                                 2 min, USAGE_ALARM) + full-screen-intent           │
│                                 notification ─▶ AlarmActivity (showWhenLocked)     │
│                └─kind=notification─▶ plain notification (default sound)            │
│   BootReceiver (BOOT_COMPLETED) → re-arm everything from AlarmStore                │
└────────────────────────────────────────────────────────────────────────────────────┘
Server (one additive deploy): CORS on /api/* — native uses it ONLY for first-run /
location-change geo endpoints (search / reverse / governorates). No new endpoints.
```

### 3a. Server changes (additive; web app unaffected)

- **CORS** on `/api/*` (`cors` package, `origin: true` — reflect; public no-auth API). Needed because
  the native origin is `https://localhost`. This is the ONLY server behavior change.
- **`iraq-calibration.ts` split (behavior-neutral, so the client can reuse the calibration logic):**
  extract the pure logic into `server/src/prayer/iraq-calibration-core.ts` (data-injected:
  `nearestGov`, `iraqCalibration(govs, …)`, `iraqExactTimes(govs, exact, …)`, `baghdadInstant` — no
  `fs`, no pino). `iraq-calibration.ts` becomes the thin server loader that `readFileSync`s the two
  JSONs and binds the core, **keeping identical exported signatures** so `compute.ts`/`payload.ts`
  and every server test are untouched. **The refactor's correctness gate: all existing server tests
  pass UNMODIFIED** (`iraq-governorates.test.ts`, `prayer.test.ts`).
- Nothing else in `server/` changes. `server/src/prayer-engine/**` is NOT edited (hard rule 2).

### 3b. Making the reused code browser-loadable (no source edits, alias-only)

Only two spots aren't browser-safe; both are handled in `client/vite.config.ts` + `tsconfig` aliases:

1. **Engine `astro.ts`** does `import { createRequire } from "node:module"` solely to load
   `astronomy-engine` CJS. Alias `node:module` → `client/src/native/node-module-shim.ts`:
   ```ts
   import * as AE from "astronomy-engine";
   export const createRequire = () => (id: string) => {
     if (id === "astronomy-engine") return AE;
     throw new Error(`shim: unexpected require("${id}")`);
   };
   ```
   Vite resolves `astronomy-engine` to its browser ESM build (add it as a `client` dependency).
2. **`iraq-calibration.ts`** reads JSON from disk + logs via pino. Provide
   `client/src/native/iraq-calibration-browser.ts` that ESM-imports the two JSONs
   (`server/data/iraq-waqf-calibration.json`, `server/data/waqf-exact.json`) and binds
   `iraq-calibration-core.ts`, exposing the same `iraqCalibration` / `iraqExactTimes` /
   `baghdadInstant` signatures. A **regex `resolve.alias`** redirects the `./iraq-calibration.js`
   import (from `compute.ts`/`payload.ts`) to this browser variant **only in the client build**.

Aliases: `@prayer-engine/* → ../server/src/prayer-engine/*`, `@prayer/* → ../server/src/prayer/*`;
Vite `server.fs.allow` includes `../server` and `../server/data`. Everything native-only is reachable
ONLY through `client/src/native/boot.ts`, loaded via `if (isNative()) await import("./native/boot")`
— Vite code-splits it, so **the web page never fetches the engine chunk** (amended hard rule 3;
verified by the `findstr` gate in §5).

- **Dockerfile (web build):** the client build stage must have `server/src/prayer-engine/`,
  `server/src/prayer/`, and `server/data/*.json` present at the alias paths. Add the COPY lines per
  `docs/DEPLOYMENT.md`. The extra native chunk ships in `dist/assets` but is never served to web
  users — acceptable.

### 3c. Client changes (all no-ops on web — everything new is behind `isNative()`)

| File | Change |
|---|---|
| `client/capacitor.config.ts` | NEW: `{ appId:'com.altijwal.prayer', appName:'مواقيت الصلاة' (⚠ text approval), webDir:'dist' }` |
| `client/src/lib/native.ts` | NEW: `isNative()` (wraps `Capacitor.isNativePlatform()`), lazy `PrayerAlarm = registerPlugin<PrayerAlarmPlugin>('PrayerAlarm')`, the TS plugin interface (§3d) |
| `client/src/lib/api.ts` | `const API_BASE = isNative() ? 'https://prayer.altijwal.com' : ''` prefixed on every fetch (geo endpoints, in practice) |
| `client/src/native/boot.ts` | NEW: dynamic-import entry — wires the times provider + scheduler when native |
| `client/src/native/node-module-shim.ts`, `client/src/native/iraq-calibration-browser.ts` | NEW: the two Vite shims (§3b) |
| `client/src/native/local-times.ts` | NEW: builds the exact `/api/prayer-times` payload locally via `buildPrayerTimesPayload` for the stored location (times, nextPrayer, hijri, events, duha/qiyam, tomorrowFajr/yesterdayIsha) |
| `client/src/hooks/usePrayerTimes.ts` | Provider seam: when native, resolve from `local-times.ts` instead of `fetch` — same return type, zero component changes |
| `client/src/lib/local-alerts.ts` + `client/src/hooks/useLocalAlerts.ts` | NEW: localStorage CRUD implementing the **same `UsePrayerAlerts` interface** as `usePrayerAlerts` (`prayer.alerts.v1`) |
| `client/src/hooks/useNativeAlarmScheduler.ts` | NEW: the sync brain (§3e) |
| `client/src/components/NotificationsOptIn.tsx` | Native branch: skip push subscription; "enable" = notification permission via plugin; rules from `useLocalAlerts`; permission rows (§3g) |
| `client/src/main.tsx` (SW registration site) | Skip service-worker registration when `isNative()` |
| `client/src/lib/storage.ts` (`StoredLocation`) | Ensure `elevation` + `country` persist at location-set time (the engine + method detection need them offline); default-backfill if absent |
| `client/src/hooks/useAlarm.ts` | Unchanged — `AlarmActivity`'s "open app" intent reuses the existing `?alarm=<target>&t=<ms>` cold-open contract |

### 3d. Plugin JS API (exact TS definition — lives in `lib/native.ts`)

```ts
export interface ScheduledAlarm {
  id: string;            // `${dateKey}-r${ruleId}-${target}` — same convention as the server fireKey
  at: number;            // epoch ms
  kind: 'alarm' | 'notification';
  title: string;         // prebuilt localized text — native renders verbatim
  body: string;
  toneId: string;        // AlarmSound id → file public/alarms/${file} (alarm kind only)
  target: string;        // AlertTarget, for the ?alarm= deep link
}
export interface PrayerAlarmPlugin {
  replaceAll(o: { alarms: ScheduledAlarm[] }): Promise<void>;  // cancel-all-then-arm; idempotent
  cancelAll(): Promise<void>;
  getState(): Promise<{ notifications: 'granted'|'denied'|'prompt';
                        exactAlarm: boolean; fullScreen: boolean; batteryExempt: boolean }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;       // ACTION_REQUEST_SCHEDULE_EXACT_ALARM
  openFullScreenIntentSettings(): Promise<void>; // ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT (API 34+)
  openBatterySettings(): Promise<void>;          // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
}
```

### 3e. Scheduling model (`useNativeAlarmScheduler`) — zero network

- Triggers: app launch, Capacitor `App.appStateChange → active` (resume), location change, rules
  change, tone change. Debounced to one sync per burst.
- Sync: compute the next **7 days** of anchor tables locally (same extended set as the server
  scheduler in `NOTIFICATIONS.md` §4: 5 fard + `duha` = duhaWindow.start + `qiyam` = last-third
  start resolved to its civil day + `adhkar_morning` = fajr + `adhkar_evening` = asr; skip
  invalid/NaN) → for each local rule × `rule.prayers` target × day:
  `at = anchor + (timing==='before' ? -min : timing==='after' ? +min : 0) * 60_000` → keep
  `now < at ≤ now + 7d` → `PrayerAlarm.replaceAll({ alarms })`.
- Text: **no new strings** — `title`/`body` reuse the exact wording of the server's `buildPushPayload`
  (`server/src/push/notification-text.ts`). Import that module client-side (it's pure text) so server
  + native emit identical text; snapshot-test parity. Latin numerals; Friday dhuhr → «الجمعة»
  (weekday from the anchor in the location tz via `Intl`).
- Offline open: local compute needs no network. Location changes are the only online action; after
  that everything recomputes locally.

### 3f. Android native components (`client/android/app/src/main/java/com/altijwal/prayer/alarm/`)

| File | Responsibility |
|---|---|
| `PrayerAlarmPlugin.kt` | `@CapacitorPlugin(name="PrayerAlarm")`; §3d methods; register in `MainActivity.onCreate` **before** `super.onCreate` (`registerPlugin(PrayerAlarmPlugin::class.java)`) |
| `AlarmStore.kt` | Persist the `ScheduledAlarm[]` JSON in SharedPreferences (written by `replaceAll`, read on boot) |
| `AlarmScheduler.kt` | Per alarm: `PendingIntent.getBroadcast(ctx, alarm.id.hashCode(), intent, FLAG_IMMUTABLE or FLAG_UPDATE_CURRENT)`; `alarmManager.setAlarmClock(AlarmClockInfo(at, showIntent), pi)`; guard `canScheduleExactAlarms()` (API 31+) — fall back `setExactAndAllowWhileIdle`, else `setWindow` |
| `AlarmReceiver.kt` | `kind=='notification'` → post on channel `prayer_reminder_v1` (IMPORTANCE_DEFAULT, default sound). `kind=='alarm'` → `startForegroundService(AlarmService)` (an exact-alarm fire is an allowed background-FGS-start exemption). Stale guard: skip if `now − at > 5 min` |
| `AlarmService.kt` | FGS `foregroundServiceType="mediaPlayback"`; posts the alarm notification on channel `prayer_alarm_v1` (IMPORTANCE_HIGH, **sound null**, `setFullScreenIntent(AlarmActivity pi, true)`, `setCategory(CATEGORY_ALARM)`, stop action); `MediaPlayer` from `assets/public/alarms/<file>` (AssetFileDescriptor), `AudioAttributes USAGE_ALARM`, `isLooping=true`; vibration waveform; self-stop + `stopForeground` after 2 min |
| `AlarmActivity.kt` | `setShowWhenLocked(true)`, `setTurnScreenOn(true)`, keyguard dismiss; dark full-screen: big clock, `title` text, stop button (stops the service, finishes), «فتح التطبيق» → launch `MainActivity` with data `https://…/?alarm=<target>&t=<at>` so the web overlay/`useAlarm` takes over. Reuse only the web `AlarmOverlay`'s already-approved strings |
| `BootReceiver.kt` | `RECEIVE_BOOT_COMPLETED` → read AlarmStore → drop past instants → re-arm. **Must NOT start any FGS itself** (Android 15 restriction) — AlarmManager calls only |

Manifest permissions: `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `USE_EXACT_ALARM`,
`USE_FULL_SCREEN_INTENT`, `RECEIVE_BOOT_COMPLETED`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `VIBRATE`, `WAKE_LOCK`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
`AlarmActivity`: `excludeFromRecents`, `launchMode="singleInstance"`, `showWhenLocked`,
`turnScreenOn`. Create both notification channels at plugin load.

### 3g. Permission onboarding (native-only section in `NotificationsOptIn`)

Status rows + fix buttons from `getState()`, re-checked on every resume (the OS can revoke
exact-alarm, which kills scheduled alarms):
1. Notifications → `requestNotificationPermission()`
2. Exact alarms (`exactAlarm:false`) → `openExactAlarmSettings()`
3. Full-screen ringing (`fullScreen:false`, API 34+) → `openFullScreenIntentSettings()`; if denied,
   degrade to heads-up notification — the tone still plays (service-driven)
4. Battery exemption (`batteryExempt:false`) → `openBatterySettings()` + a one-line OEM notice
   (Xiaomi/HyperOS-class killers)

⚠ These four row labels + the OEM notice are **NEW user-visible Arabic strings — propose to the user
for approval BEFORE implementing** (standing rule, 2026-07-03). Everything else reuses approved text.

## 4. Step-by-step implementation (phases; each ends with must-pass gates)

**Phase 1 — Server: split `iraq-calibration` (behavior-neutral).**
Extract `iraq-calibration-core.ts`; make `iraq-calibration.ts` the thin loader; identical exports.
Gate: `cd server && npm test` (ALL existing tests green, UNMODIFIED) `&& npx tsc --noEmit`.

**Phase 1b — Client offline compute + parity test.**
Add `astronomy-engine` dep; Vite/tsconfig aliases; `node-module-shim.ts`; `iraq-calibration-browser.ts`;
regex alias; `native/local-times.ts`.
Gate: `cd client && npm run build`; `cd client && npm test` — new **parity vitest**: local payload
for Baghdad + 3 governorates × sample dates (INCLUDING a `waqf-exact.json` digitized date, e.g.
2026-06-19) equals the server route's output to the minute (port `iraq-governorates.test.ts`
assertions). Web-bundle check: `findstr /m astronomy client\dist\assets\*.js` matches ONLY the lazy
native chunk.

**Phase 2 — Capacitor shell + CORS.**
Server: add `cors` (`origin:true`) on `/api/*`; deploy (`docs/DEPLOYMENT.md`).
Client: `npm i @capacitor/core@^8 @capacitor/app@^8 astronomy-engine && npm i -D @capacitor/cli@^8
@capacitor/android@^8`; `npx cap init "مواقيت الصلاة" com.altijwal.prayer --web-dir=dist`;
`npm run build && npx cap add android && npx cap sync android`. Add `lib/native.ts`, `API_BASE`,
SW-registration skip. Gitignore android build outputs + keystores (keep sources).
Gate: `npm run build` green; `cd client/android && .\gradlew.bat assembleDebug` green; emulator shows
live Baghdad times (proves CORS + API_BASE); `curl -H "Origin: https://localhost"
https://prayer.altijwal.com/api/geo/governorates?country=IQ` returns the `access-control-allow-origin`
header.

**Phase 3 — Offline provider + local rules + scheduler stub.**
`native/boot.ts` dynamic-import seam; `usePrayerTimes` provider seam; `local-alerts.ts` +
`useLocalAlerts`; `NotificationsOptIn` native branch; `useNativeAlarmScheduler` computing the 7-day
plan and logging it (no plugin call yet); persist `elevation`+`country`.
Gate: `npm run build` + `npm test` (client vitests: local-alerts CRUD, instant math incl.
before/after across midnight, `notification-text` snapshots); emulator in **airplane mode after first
location set** → relaunch still shows correct times + countdown; scheduler logs the expected 7-day
alarm list.

**Phase 4 — The `PrayerAlarm` plugin (core).**
All Kotlin of §3f + manifest + channels + `MainActivity` registration. Dev-only "test alarm in 60 s"
button (`import.meta.env.DEV` only).
Gate: `assembleDebug` green; emulator: test alarm fires with the app swiped away + screen locked +
**airplane mode** → full-screen activity + looping chosen tone + vibration; Stop works;
`kind:'notification'` fires quiet; `adb reboot` before the instant → still fires (BootReceiver).

**Phase 5 — Permissions UX + robustness.**
§3g onboarding (⚠ get string approval first); re-check `getState()` on resume; all re-sync triggers
wired (location/rules/tone/resume); 2-min auto-stop; stale guard.
Gate: revoke exact-alarm in OS settings → app surfaces the fix row on next open; re-grant → alarms
re-arm (`adb shell dumpsys alarm | findstr com.altijwal.prayer`); `npm run build`, client + server
suites green.

**Phase 6 — Release.**
Upload keystore (NEVER commit; document location/passwords in `docs/OPERATIONS.md`),
`.\gradlew.bat bundleRelease`, Play Console: $25 account, listing, **declarations: USE_EXACT_ALARM
(alarm functionality) + full-screen-intent**, data-safety form, internal testing → production. Device
matrix: one stock Android + one Xiaomi/HyperOS if available.
Gate: `bundleRelease` green; internal-track install rings with the app closed **and airplane mode on**.

**Phase B (DEFERRED) — iOS.** Prereqs: Apple Developer enrollment ($99/yr) + cloud macOS CI (GitHub
Actions `macos-15` runner or Codemagic — no local Mac). Swift side of the same plugin:
`AlarmManager.requestAuthorization()`, per-instant **`.fixed(Date)` AlarmKit alarms** (never
`.relative` recurrence — prayer times shift daily), custom sound `.named(tone)` from ≤30 s bundle
copies (trim `soft-plucks` 60 s, `star-dust` 58 s, `morning-joy` 33 s), stop-button config, ID
tracking for cancel (no cancel-all API); `#available(iOS 26)` else `UNUserNotificationCenter` +
`.timeSensitive` fallback (64-cap, top-up on open; horizon 2–3 days). `NSAlarmKitUsageDescription` in
Info.plist. **Never add a `com.apple.developer.alarmkit` entitlement — it does not exist** (a
documented LLM hallucination that breaks builds). No Live Activity target needed (fixed alarms only).
Test on real hardware (Simulator sound unreliable). Offline compute is identical (same webview chunk).
Risks: App Store 4.2 webview scrutiny (mitigated by real AlarmKit integration + offline bundle);
custom-sound looping quirks pre-iOS 26.1.

## 5. Acceptance criteria

**Commands that must pass (Windows PowerShell, from repo root):**
```
cd server && npm test                          # existing suites green UNCHANGED after the split
cd server && npx tsc --noEmit
cd client && npm run lint
cd client && npm run build                     # tsc -b + vite — THE client typecheck gate
cd client && npm test                          # parity, local-alerts, instant math, text snapshots
cd client && npx cap sync android
cd client/android && .\gradlew.bat assembleDebug
cd client/android && .\gradlew.bat bundleRelease    # Phase 6
findstr /m astronomy client\dist\assets\*.js        # matches ONLY the lazy native chunk
```

**Observable behavior (emulator/device):**
1. **Offline core:** set location once (online) → enable airplane mode → relaunch: correct times,
   countdown ticks, Hijri/events render; an alarm-kind rule rings full-screen with the chosen tone at
   the instant (±5 s) with the app swiped away + screen locked; Stop silences; untouched → auto-stops
   at 2 min. **No network for any of this.**
2. `adb reboot` (still offline) before the instant → alarm still fires without opening the app.
3. Notification-kind rule → quiet standard notification at the instant, no takeover.
4. Tone/location/rule change re-schedules (verify `adb shell dumpsys alarm`); 7-day horizon armed.
5. Exact-alarm permission revoked in OS settings → fix row on next open; re-grant → re-armed.
6. FSI not granted → heads-up notification + tone still rings (service-driven).
7. **Parity:** client-computed times for calibrated Iraqi governorates equal the live API to the
   minute, including an exact-override (Waqf) date.
8. **Web regression:** https://prayer.altijwal.com behaviour unchanged; web main bundle is
   engine-free (`findstr` gate); server tests unchanged-green.
9. No new user-visible strings shipped without prior approval (§3g list).

## 6. Hard guardrails for the implementing model

- NEVER edit `server/src/prayer-engine/**` — the browser adaptation is the Vite `node:module` alias
  shim ONLY. NEVER import the engine (or `astronomy-engine`) into a WEB-reachable code path.
- The WEB main bundle must never contain astronomy/engine code (dynamic-import isolation; verified by
  the `findstr` gate). `AGENTS.md` hard rule 3 is amended to state exactly this.
- NEVER commit: keystores/passwords, `docs/OPERATIONS.md`, `CLAUDE.md`, VPS details, VAPID keys.
- Server changes are ADDITIVE only (CORS + behavior-neutral `iraq-calibration` split); existing tests
  must pass UNMODIFIED — that is the split's correctness proof.
- Calibration JSONs are generated artifacts (`scripts/build-waqf-calibration.ts`) — import, never
  hand-edit (hard rule 5).
- All instants are epoch ms; no device-tz `Date` arithmetic in scheduling (location tz only).
- Client TS is verified ONLY by `npm run build` (bare `tsc --noEmit` is a no-op in `client/`).
- Conventional commits; small focused files (<800 lines); pino `childLogger` server-side; zod stays
  at the (unchanged) API boundary.
- Do not add `com.apple.developer.alarmkit` (nonexistent). Do not swap in
  `@capacitor/local-notifications` or any community alarm plugin.
