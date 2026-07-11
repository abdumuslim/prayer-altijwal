# Native Alarm Fix-Round Spec (Android) — emulator-verified

> **Status: IMPLEMENTED + emulator-verified (2026-07-11).** All three defects were reproduced on a
> local Android emulator (`prayer36`, API 36 google_apis x86_64) with the current debug APK, then
> fixed and re-verified on the same emulator (build + 86 client tests green; APK rebuilt). This
> document is retained as the change record + regression guide. It is a **fix round on top of the
> built app** described in `docs/NATIVE_ALARM_SPEC.md` (Phases 1–5). Read that doc first for the
> as-built architecture; read `docs/FRONTEND.md` (§9 web alarm UI) and `docs/NOTIFICATIONS.md` (rule
> model) for context.
>
> **Verification results (emulator, fixed APK):** ① fresh install (Settings never opened) arms **132**
> alarms immediately; ② hardware back closes the open panel, and at the root screen minimizes the app
> (home shown, process alive) — no longer a dead no-op; ③ an alarm fired with the screen off shows the
> web-overlay-styled dark ring screen (smooth gold glow, centered gold label, huge clock, live
> «المتبقي للأذان» countdown for before-rules, chevrons + translucent ✕), not the white splash; ④ the
> launcher shows the mosque adaptive icon. Client build + 86 tests green throughout.
>
> **Reproduction evidence (emulator, current APK):**
> - **Bug 1:** an alarm rule written to `prayer.alerts.v1` while the app runs → `dumpsys alarm` shows
>   **0** `com.altijwal.prayer` alarms, *even after backgrounding+foregrounding* (the resume re-sync
>   reuses the stale in-memory rules). Only a **full app restart** re-reads storage → **132** alarms
>   armed (`setAlarmClock`, `exactAllowReason=policy_permission`). ⇒ native plumbing is correct; the
>   defect is the JS state disconnect. Exact-alarm is auto-granted on the image, so permissions are NOT
>   the cause. A fresh install has **no rule at all** (default only seeds when Settings is opened).
> - **Bug 2:** with the Settings panel open, `input keyevent 4` (hardware back) three times → panel
>   stays open, app stays on `MainActivity`. Back is a dead no-op.
> - **Bug 3 (also reported by the user: "white screen with the blue app logo"):** firing an alarm
>   with the screen off correctly brings `AlarmActivity` to the front (`topResumedActivity=…/.alarm.AlarmActivity`),
>   but it renders as the **white Capacitor splash with the blue logo** instead of the dark clock UI —
>   because the activity's theme is the splash launch theme (root cause in §2e).
>
> **Hard constraints for the implementer (do not violate):**
> - **No server changes** in this round. `cd server && npm test` must stay green, untouched.
> - **Never edit `server/src/prayer-engine/**`** (hard rule 2). No engine changes at all here.
> - **No new or changed user-visible strings.** Everything below reuses already-approved text and
>   touches only wiring/state/native-icon assets. If you think you need a new string, STOP.
> - **Client TypeScript is verified ONLY by `npm run build`** (bare `tsc --noEmit` is a no-op in
>   `client/` — it's a solution-style config). See `AGENTS.md`.
> - Conventional commits (`fix:` / `feat:` / `chore:`); small focused files (<800 lines); immutable
>   updates (never mutate arrays/objects in place).
> - The web app and the live site https://prayer.altijwal.com must be byte-for-byte unaffected — every
>   change here is either native-only (behind `isNative()`) or a pure refactor with identical behavior.

---

## 1. Goal

Fix the three defects that make the built native Android app unusable, and give it the app's own brand
icon. **(Bug 1 — alarms never fire:** `useLocalAlerts` is per-component React state, so the
reminder-rule editor in `NativeReminders` and the alarm scheduler in `App` hold two *disconnected*
copies — rules the user creates never reach the running scheduler, which therefore arms zero OS
alarms. **(Bug 2 — hardware Back does nothing:** no Capacitor `backButton` listener exists, so
Android's back press is swallowed with no effect on the in-app panels. **(Bug 3 — the ring screen is a
blank white splash:** `AlarmActivity` is declared with the splash launch theme, so when an alarm fires
the user sees the white Capacitor-logo splash instead of the dark clock/prayer-name UI. **(Task 4 —
wrong logo:** the launcher icon and splash are still the stock Capacitor placeholders.) The fix
converts the local rules into a single module-level store consumed via `useSyncExternalStore`, adds a
`backButton` handler that closes the top-most overlay (or minimizes the app at root), gives
`AlarmActivity` a dedicated dark theme so its UI renders, and regenerates the Android launcher icon +
splash from the web app's mosque logo — then proves an alarm actually rings (with a correct screen) on
the emulator with the app closed.

---

## 2. Architecture & system changes

All changes are in `client/`. Three independent workstreams (2a, 2b, 2c) + a test environment already
provisioned (2d). Nothing in `server/` changes.

### 2a. Single shared rules store — fixes Bug 1

**Problem (verified):** `client/src/hooks/useLocalAlerts.ts` backs its rules with component-local
`useState`. Two components call it independently:
- `App.tsx:118` `const localAlerts = useLocalAlerts();` → feeds `useNativeAlarmScheduler` (`App.tsx:119-127`).
- `NativeReminders.tsx:26` `const local = useLocalAlerts();` → the rule editor **and** the first-run seeder.

They share only `localStorage`, not React state, so a rule added in Settings updates the editor's copy
but **not** the scheduler's copy → the scheduler's `sig` never changes → `PrayerAlarm.replaceAll` is
never re-invoked with the new rule. Result: **no alarm is ever armed.** The Java plugin is correct; it
just never receives a non-empty `alarms` array.

**Fix:** promote the rules to a module-level external store and read it through `useSyncExternalStore`,
keeping the `UseLocalAlerts` interface identical so no consumer changes.

1. **NEW `client/src/lib/local-alerts-store.ts`** — the single source of truth. Reuse the existing
   pure, persisting helpers from `local-alerts.ts` verbatim (`addLocalAlert` / `updateLocalAlert` /
   `removeLocalAlert` already call `saveLocalAlerts`).
   ```ts
   import {
     addLocalAlert, loadLocalAlerts, removeLocalAlert, updateLocalAlert,
     type LocalAlertRule,
   } from "./local-alerts";

   let rules: LocalAlertRule[] = loadLocalAlerts();   // module snapshot; STABLE reference between mutations
   const listeners = new Set<() => void>();
   function emit(): void { for (const l of listeners) l(); }

   export function subscribeLocalAlerts(listener: () => void): () => void {
     listeners.add(listener);
     return () => { listeners.delete(listener); };
   }
   export function getLocalAlerts(): LocalAlertRule[] { return rules; }        // MUST return same ref until change

   export function addRule(input: Omit<LocalAlertRule, "id">): void {
     rules = addLocalAlert(rules, input); emit();
   }
   export function updateRule(id: number, input: Omit<LocalAlertRule, "id">): void {
     rules = updateLocalAlert(rules, id, input); emit();
   }
   export function removeRule(id: number): void {
     rules = removeLocalAlert(rules, id); emit();
   }

   const SEED_KEY = "prayer.alerts.seeded.v1";
   /** Seed one sensible default rule the FIRST launch only. Idempotent; never
    *  re-seeds after a deliberate delete-all (guarded by the marker key). */
   export function seedDefaultLocalAlerts(): void {
     try {
       if (localStorage.getItem(SEED_KEY)) return;
       localStorage.setItem(SEED_KEY, "1");
     } catch { return; }
     if (rules.length === 0) {
       addRule({
         timing: "before", minutes: 10,
         prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
         kind: "notification",   // matches the web default; user upgrades a rule to kind:'alarm' to get a ring
       });
     }
   }
   ```
   ⚠ **Critical invariant:** `getLocalAlerts()` must return the **same array reference** until a
   mutator runs. React throws `The result of getSnapshot should be cached to avoid an infinite loop`
   if you return a fresh array (e.g. `loadLocalAlerts()`) each call. The module-level `rules` variable,
   reassigned only inside the mutators, satisfies this because the helpers are immutable.

2. **REWRITE `client/src/hooks/useLocalAlerts.ts`** into a thin wrapper — **`UseLocalAlerts` interface
   unchanged** (`{ rules, add, update, remove }`), so `App.tsx` and `NativeReminders.tsx` need no edits
   to their call sites:
   ```ts
   import { useSyncExternalStore } from "react";
   import {
     addRule, getLocalAlerts, removeRule, subscribeLocalAlerts, updateRule,
   } from "@/lib/local-alerts-store";
   import type { LocalAlertRule } from "@/lib/local-alerts";

   export interface UseLocalAlerts {
     rules: LocalAlertRule[];
     add: (input: Omit<LocalAlertRule, "id">) => void;
     update: (id: number, input: Omit<LocalAlertRule, "id">) => void;
     remove: (id: number) => void;
   }
   export function useLocalAlerts(): UseLocalAlerts {
     const rules = useSyncExternalStore(subscribeLocalAlerts, getLocalAlerts);
     return { rules, add: addRule, update: updateRule, remove: removeRule };
   }
   ```
   (`add`/`update`/`remove` are module functions → referentially stable, no `useCallback` needed.)

3. **Move seeding out of `NativeReminders.tsx`.** Delete its `seeded` `useRef` + the `useEffect`
   (`NativeReminders.tsx:30-42`) and the now-unused `useEffect`/`useRef` imports if they become unused.
   In `App.tsx`, seed once on native mount:
   ```ts
   import { seedDefaultLocalAlerts } from "@/lib/local-alerts-store";
   import { isNative } from "@/lib/native";
   ...
   useEffect(() => { if (isNative()) seedDefaultLocalAlerts(); }, []);
   ```
   Rationale: the old seeder only ran if the user opened Settings (`SlideOver` mounts `NativeReminders`
   lazily) — a fresh user who never opened Settings had zero rules and zero alarms. Seeding at app
   mount fixes that; the `SEED_KEY` marker means a user who deletes all rules stays at zero.

4. **`useNativeAlarmScheduler.ts:76-78`** — replace the silent `catch {}` so a real failure is never
   invisible again:
   ```ts
   } catch (err) {
     console.error("[native-alarm] replaceAll failed", err);
   }
   ```
   (Console logging is acceptable in this native-only path; it surfaces in `adb logcat`. Do not add a
   pino logger here — this is client code.)

**No other file changes for 2a.** `sig` (`useNativeAlarmScheduler.ts:43-55`) already includes
`params.rules`; once both hooks read the same snapshot, every editor change re-arms alarms.

### 2b. Hardware Back handler — fixes Bug 2

**Problem (verified):** `@capacitor/app` 8.1.0 registers an always-enabled androidx
`OnBackPressedCallback` that consumes every back press; with **no** JS `backButton` listener and no
web history (`webView.canGoBack() === false` — the SPA has one history entry), its handler does
nothing. So Back neither closes a panel nor leaves the app. Registering a JS listener suppresses that
default and lets us route Back ourselves.

1. **NEW `client/src/hooks/useAndroidBack.ts`:**
   ```ts
   import { useEffect, useRef } from "react";
   import { App as CapApp } from "@capacitor/app";
   import { isNative } from "@/lib/native";

   /** Register the Android hardware-back handler (native only).
    *  handler() returns true when it consumed the press (closed an overlay);
    *  returning false means we're at the root → minimize the app (stock Android
    *  root-back: task to background, warm resume). */
   export function useAndroidBack(handler: () => boolean): void {
     const ref = useRef(handler);
     ref.current = handler;                       // always call the freshest closure; register once
     useEffect(() => {
       if (!isNative()) return;
       const p = CapApp.addListener("backButton", () => {
         if (!ref.current()) void CapApp.minimizeApp();
       });
       return () => { void p.then((h) => h.remove()); };  // addListener returns a Promise
     }, []);
   }
   ```
   Notes: use `minimizeApp()` (= `moveTaskToBack(true)`), **not** `exitApp()` (which cold-kills the
   WebView). Do **not** set the plugin's `disableBackButtonHandler` config. The `{ canGoBack }` event
   field is irrelevant for this SPA and can be ignored.

2. **Wire it in `App.tsx`** (all overlay state already lives in `App`), closing the top-most overlay in
   priority order:
   ```ts
   useAndroidBack(() => {
     if (alarm.alarm) { alarm.dismiss(); return true; }
     if (sheet !== null) { setSheet(null); return true; }   // covers rawatib/adhkar/stats/reader
     if (settingsOpen) { setSettingsOpen(false); return true; }
     if (searchOpen) { setSearchOpen(false); return true; }
     return false;                                          // root → minimize
   });
   ```
   Place the call near the other top-level hooks in `App()` (after the `useState`s for
   `searchOpen`/`settingsOpen`/`sheet` and after `alarm`). It is a no-op on web.

### 2c. Launcher icon + splash from the web logo — Task 3

**Problem (verified):** `client/android/app/src/main/res/mipmap-*` hold the stock Capacitor icon and
`drawable*/splash.png` the stock Capacitor splash. The web logo is
`client/public/icons/favicon.svg` (512-viewBox mosque: crescent+star, dome+two minarets, on a dark
`#0a2c2a→#04181a` rounded square), with raster siblings `icon-512.png` and `icon-maskable-512.png`.
Brand background: `#04181a`.

Use the official **`@capacitor/assets`** generator (bundles `sharp`) in **custom mode**. Because the
favicon bakes its own rounded background into the artwork, decompose it into adaptive layers so
Android's mask doesn't clip it.

1. `npm i -D @capacitor/assets` (in `client/`).
2. **NEW `client/scripts/make-icon-assets.mjs`** — a small node script (run from `client/`) that uses
   the hoisted `sharp` to produce `client/assets/`:
   - `icon-foreground.png` — `public/icons/icon-maskable-512.png` resized to **1024×1024** (maskable art
     already sits in the safe zone).
   - `icon-background.png` — solid `#04181a`, **1024×1024**.
   - `icon-only.png` — `public/icons/favicon.svg` rasterized at **1024×1024**
     (`sharp(svgBuffer, { density: 144 })`, i.e. 72 × 1024/512, for crisp edges) — the legacy
     (non-adaptive) icon; its baked rounded corners are fine.
   - `splash.png` and `splash-dark.png` — **2732×2732** solid `#04181a` with the favicon render
     composited centered at ~25% width. (Custom mode silently skips splash if these are absent, leaving
     the stock Capacitor splash — so they MUST be produced.)
   Keep the script deterministic and committed; document the one-line run in the file header.
3. `npx capacitor-assets generate --android` (defaults: `--assetPath assets`, `--androidProject
   android`). Writes `mipmap-*/ic_launcher*.png`, `mipmap-*/ic_launcher_background.png`,
   `mipmap-anydpi-v26/ic_launcher*.xml`, and `drawable*/splash.png`. **Note:** `--iconBackgroundColor`
   is ignored in custom mode (background comes from `icon-background.png`) — don't rely on it.
4. **`client/android/app/src/main/res/values/styles.xml`** → in `AppTheme.NoActionBarLaunch` add the
   Android-12+ system-splash background so cold launch shows brand color, not white:
   ```xml
   <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
       <item name="android:background">@drawable/splash</item>
       <item name="windowSplashScreenBackground">#04181a</item>
   </style>
   ```
5. Delete any resources the regeneration orphans **if present**:
   `res/values/ic_launcher_background.xml` (color), `res/drawable/ic_launcher_background.xml`,
   `res/drawable-v24/ic_launcher_foreground.xml` (the new `ic_launcher.xml` references
   `@mipmap/ic_launcher_background` instead).
6. Commit `client/assets/` + the generator script (the regeneration recipe). **No manifest change** —
   `AndroidManifest.xml` already points `android:icon="@mipmap/ic_launcher"` /
   `android:roundIcon="@mipmap/ic_launcher_round"`.

### 2e. AlarmActivity dark theme — fixes Bug 3 (white-splash ring screen)

**Problem (verified):** `AndroidManifest.xml` declares
`<activity android:name=".alarm.AlarmActivity" android:theme="@style/AppTheme.NoActionBarLaunch" …>`.
That theme's parent is `Theme.SplashScreen` with `android:windowBackground = @drawable/splash` (the
Capacitor splash — white with the blue logo). So the alarm window paints the splash; the dark
`LinearLayout` + 72sp white clock that `AlarmActivity.onCreate` builds is not what the user sees
(white-on-white clock, splash logo on top). `AlarmActivity` extends plain `android.app.Activity`, so
it just needs a plain dark, no-action-bar, no-splash window theme.

**Fix:** add a dedicated theme and point the activity at it.
1. In `client/android/app/src/main/res/values/styles.xml`, add:
   ```xml
   <style name="AlarmTheme" parent="Theme.AppCompat.NoActionBar">
       <item name="android:windowBackground">@color/alarmBackground</item>
       <item name="android:windowNoTitle">true</item>
       <item name="android:windowActionBar">false</item>
       <item name="android:statusBarColor">@color/alarmBackground</item>
       <item name="android:navigationBarColor">@color/alarmBackground</item>
   </style>
   ```
   and define the color in `res/values/colors.xml`:
   `<color name="alarmBackground">#04181A</color>` (the app's night color — same as the ring screen's
   base, so there is no flash of a different color before `setContentView`).
2. In `AndroidManifest.xml`, change the `AlarmActivity` line to
   `android:theme="@style/AlarmTheme"` (keep `showWhenLocked`, `turnScreenOn`, `excludeFromRecents`,
   `launchMode="singleInstance"`, `exported="false"`).

⚠ **Interaction with Task 4 (icon/splash):** even after the launcher splash is rebranded, the alarm
screen must use `AlarmTheme` (a bare dark window), NOT the splash theme — otherwise it would show the
*brand* splash instead of the clock. Do both.

**AS-BUILT additions (user-requested during verification, 2026-07-11):**
- **Ring-screen redesign — visual parity with the web `AlarmOverlay`** (`docs/FRONTEND.md` §9):
  `AlarmActivity` now renders the night background `#04181a` with the warm gold radial glow
  (`circle at 50% 32%, rgba(245,196,81,.16) → transparent 58%`), a **centered** pulsing gold
  ringing label (lucide alarm-clock vector + 18sp gold title), the huge live 12-hour clock (84sp,
  `sans-serif-black`, Latin numerals + Arabic day-period from the platform formatter), the body line,
  and the web's bouncing gold chevrons + round translucent ✕ stop control (swipe-up ≥90dp or tap).
  New drawables: `ic_alarm_clock.xml`, `ic_chevrons_up.xml`, `ic_x.xml`, `bg_stop_button.xml`.
  The glow is painted by a custom `GlowLayout` with a **dithered `RadialGradient` shader** — the XML
  `GradientDrawable` equivalent shows visible banding rings (Android doesn't dither drawable
  gradients; Chrome does, which is why the web looks smooth).
- **Live countdown to the adhan** (the point of a «قبل الأذان» rule): `ScheduledAlarm` gained
  `anchorAt` (the adhan/window instant, epoch ms) and `untilLabel` (the reused, already-approved hero
  string `next.header` «المتبقي للأذان», localized in `schedule.ts`). Plumbed JS→Java through
  `lib/native.ts` → `native/schedule.ts` → `ScheduledAlarm.java` (JSON roundtrip; old entries default
  `anchorAt = at`) → `AlarmScheduler` extras → `AlarmReceiver.putExtras` → `AlarmService` → the
  full-screen intent → `AlarmActivity`, which ticks a gold `mm:ss` (or `h:mm:ss`) countdown under the
  clock and hides it once the anchor passes (so at-time/after rules show no countdown). Covered by
  `schedule.test.ts` (anchor offsets ±, label value).

### 2d. Test environment (already provisioned this session)

A **second SDK root on D:** (nothing new written to C: except a possible <1 KB AVD `.ini`) — the app's
gradle build keeps using the C: SDK via `client/android/local.properties` (`sdk.dir` wins over env
vars, so builds are unaffected):

- SDK: `D:\Android\Sdk` (installed `platform-tools`, `emulator`, `cmdline-tools;latest`,
  `system-images;android-36;google_apis;x86_64`).
- AVD: `prayer36` (Pixel 7 profile, API 36, WHPX-accelerated) at `D:\Android\avd` (via
  `ANDROID_AVD_HOME`).
- Launch: `& 'D:\Android\Sdk\emulator\emulator.exe' -avd prayer36` (set
  `$env:ANDROID_AVD_HOME='D:\Android\avd'` first). Use `C:\...\Sdk\platform-tools\adb.exe` for all adb.
- `google_apis` (not `playstore`) image ⇒ `adb root` works, enabling the direct-broadcast smoke test
  in §4.

Provisioning commands are in `docs/NATIVE_ALARM_SPEC.md` command block / this repo's session notes;
they are idempotent (re-runnable).

---

## 3. Step-by-step implementation

Do the phases in order; run each gate before moving on.

**Phase 1 — Baseline reproduction (already done this session; re-confirm if the APK changed).**
Boot `prayer36`; `adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk`; open the
app; open Settings → add a `kind:alarm` rule. Confirm the bugs: `adb shell dumpsys alarm` shows **no**
`com.altijwal.prayer` alarms; `adb shell input keyevent 4` with a panel open does nothing.

**Phase 2 — Shared rules store (2a).** Implement `local-alerts-store.ts`, rewrite `useLocalAlerts.ts`,
move seeding to `App.tsx`, fix the scheduler `catch`. Add **NEW vitest**
`client/src/lib/local-alerts-store.test.ts`:
- two subscribers both fire on a single `addRule`; the snapshot reference changes exactly once.
- `getLocalAlerts()` returns an identical reference across calls when nothing mutated (guards the
  infinite-loop invariant).
- `seedDefaultLocalAlerts()` seeds exactly one default when empty, is a no-op on second call, and does
  not re-seed after all rules are removed (marker set).
Keep all existing client tests green.
Gate: `cd client && npm run build && npm test`.

**Phase 3 — Back handler (2b).** Implement `useAndroidBack.ts`, wire it in `App.tsx`. Add **NEW vitest**
mocking `@capacitor/app` + forcing `isNative()` true: handler returning true does NOT call
`minimizeApp`; handler returning false DOES; the listener handle is removed on unmount.
Gate: `cd client && npm run build && npm test`.

**Phase 4 — AlarmActivity dark theme (2e).** Add `AlarmTheme` + `alarmBackground` color; repoint the
manifest. Fast to verify on the emulator (fire an alarm with the screen off → dark clock UI, not a
white splash).
Gate: `cd client && npx cap sync android && cd android && .\gradlew.bat assembleDebug`.

**Phase 5 — Icon + splash (2c).** Add the dep, the generator script, run it, edit `styles.xml`
(`windowSplashScreenBackground`), delete orphans.
Gate: `cd client && npm run build && npx cap sync android && cd android && .\gradlew.bat assembleDebug`.

**Phase 6 — Emulator verification + docs.** Rebuild + reinstall the APK; run the full §4 checklist.
Then update: this file's status line, `docs/NATIVE_ALARM_SPEC.md` (mark on-device firing verified),
and Tier-2 memory `native_alarm_state.md`. Commit each workstream as its own `fix:`/`feat:` commit.

---

## 4. Acceptance criteria

### Commands that MUST pass (Windows PowerShell, from repo root)
```
cd client; npm run build                    # tsc -b + tsc -p tsconfig.native.json + vite — THE typecheck gate
cd client; npm test                         # existing suites + new store + back tests, all green
cd client; npx cap sync android
cd client/android; .\gradlew.bat assembleDebug
cd server; npm test                         # UNTOUCHED, still green (proves no server drift)
findstr /m astronomy client\dist\assets\*.js   # still matches ONLY the lazy native chunk (web stays engine-free)
```

### Observable behavior on the emulator (`prayer36`; `adb root` available)
Use `C:\...\Sdk\platform-tools\adb.exe`. Package id `com.altijwal.prayer`.

1. **Seeding without opening Settings (was broken):** `adb shell pm clear com.altijwal.prayer`,
   relaunch, do NOT open Settings → within a few seconds
   `adb shell dumpsys alarm | Select-String -Context 0,8 'com.altijwal.prayer'` lists armed alarms
   (the default rule × the 7-day horizon).
2. **Live re-arm (the core regression):** open Settings, add a `kind:alarm` rule → **without
   restarting the app**, `dumpsys alarm` shows the new instants; delete the rule → they disappear.
3. **Real ring, app closed + offline:**
   `adb shell settings put global auto_time 0`, then
   `adb shell cmd alarm set-time <epochMs>` to ~1 min before an armed alarm instant; swipe the app
   away; screen off; `adb shell cmd connectivity airplane-mode enable` → at the instant the full-screen
   `AlarmActivity` appears over the lock screen with the looping chosen tone; **Stop** silences it;
   left alone it auto-stops at 2 min.
   *Fast smoke test of the fire path (as root, bypassing scheduling):*
   ```
   adb root
   adb shell am broadcast -n com.altijwal.prayer/.alarm.AlarmReceiver -a com.altijwal.prayer.FIRE_ALARM \
     --es id t1 --es kind alarm --el at <nowEpochMs> --es title Test --es body now --es toneId x --es target fajr
   ```
   (bogus `toneId` falls back to the system alarm ringtone; `at≈now` passes the 5-min stale guard.)
4. **Reboot persistence:** `adb reboot` before an armed instant → it still fires (BootReceiver re-arms).
5. **Notification kind:** a `kind:notification` rule posts a quiet standard notification at the instant
   (grant first: `adb shell pm grant com.altijwal.prayer android.permission.POST_NOTIFICATIONS`).
6. **Back button** (`adb shell input keyevent 4`) closes, in order: alarm overlay → open worship sheet
   → Settings panel → search panel; pressed at the root screen the app **minimizes** (stays in Recents,
   resumes instantly). It is never a dead no-op again.
7. **Ring screen (Bug 3 + as-built design):** firing an alarm with the screen off shows the dark
   web-overlay-styled `AlarmActivity` — smooth gold glow (no banding rings), centered pulsing gold
   prayer label, huge live clock with Arabic day-period, and for «قبل الأذان» rules a live gold
   «المتبقي للأذان» `mm:ss` countdown to the adhan (hidden for at-time/after rules and once the adhan
   passes); bottom chevrons + round translucent ✕ (tap or swipe-up stops) — **never** the white
   Capacitor-logo splash.
8. **Logo:** launcher shows the mosque adaptive icon (art on `#04181a`); cold launch shows the brand
   splash on `#04181a`; no Capacitor placeholder anywhere.
9. **No swallowed errors:** `[native-alarm] replaceAll failed` does NOT appear in `adb logcat` during
   any of the above.
10. **Web regression:** `cd client && npm run dev` → the web UI is unchanged; no new user-visible
    strings anywhere in the diff.

---

## 5. File-change checklist (for the implementer)

| File | Change | Workstream |
|---|---|---|
| `client/src/lib/local-alerts-store.ts` | **NEW** — module store + seeder (reuses `local-alerts.ts` helpers) | 2a |
| `client/src/hooks/useLocalAlerts.ts` | **REWRITE** — thin `useSyncExternalStore` wrapper, same interface | 2a |
| `client/src/components/NativeReminders.tsx` | Delete the seed `useRef`+`useEffect` (lines ~30-42); drop now-unused imports | 2a |
| `client/src/App.tsx` | Call `seedDefaultLocalAlerts()` on native mount; add `useAndroidBack(...)` | 2a, 2b |
| `client/src/hooks/useNativeAlarmScheduler.ts` | Replace silent `catch {}` with `console.error` (lines 76-78) | 2a |
| `client/src/hooks/useAndroidBack.ts` | **NEW** — Capacitor `backButton` listener hook | 2b |
| `client/src/lib/local-alerts-store.test.ts` | **NEW** vitest | 2a |
| `client/src/hooks/useAndroidBack.test.ts` (or `.tsx`) | **NEW** vitest | 2b |
| `client/package.json` | add `@capacitor/assets` devDep | 2c |
| `client/scripts/make-icon-assets.mjs` | **NEW** — rasterize favicon → `client/assets/*` | 2c |
| `client/assets/*` | **NEW** generated icon/splash sources (committed) | 2c |
| `client/android/app/src/main/res/mipmap-*`, `drawable*/splash.png`, `mipmap-anydpi-v26/ic_launcher*.xml` | regenerated by `capacitor-assets` | 2c |
| `client/android/app/src/main/res/values/styles.xml` | add `windowSplashScreenBackground` (2c) + `AlarmTheme` (2e) | 2c, 2e |
| `client/android/app/src/main/res/values/colors.xml` | add `alarmBackground` color `#04181A` | 2e |
| `client/android/app/src/main/AndroidManifest.xml` | `AlarmActivity` `android:theme` → `@style/AlarmTheme` (ONLY this attribute) | 2e |
| `client/android/app/src/main/res/{values/ic_launcher_background.xml, drawable/ic_launcher_background.xml, drawable-v24/ic_launcher_foreground.xml}` | delete if orphaned | 2c |
| `client/android/app/src/main/res/drawable/{ic_alarm_clock, ic_chevrons_up, ic_x, bg_stop_button}.xml` | **NEW** — ring-screen vectors + button bg | 2e as-built |
| `client/android/app/src/main/java/.../alarm/AlarmActivity.java` | **REWRITE UI** — web-overlay design + dithered glow + countdown | 2e as-built |
| `client/android/app/src/main/java/.../alarm/{ScheduledAlarm, AlarmScheduler, AlarmService}.java` | plumb `anchorAt` + `untilLabel` | 2e as-built |
| `client/src/lib/native.ts`, `client/src/native/schedule.ts`, `client/src/native/schedule.test.ts` | `ScheduledAlarm.anchorAt`/`untilLabel` + tests | 2e as-built |

**Do NOT touch:** anything in `server/`, `server/src/prayer-engine/**`, any user-visible string /
i18n dict (the countdown label REUSES the existing `next.header`), or `capacitor.config.ts` appName.
The ONLY `AndroidManifest.xml` edit is the `AlarmActivity` `theme` attribute (2e).
