# Native Alarm — research & vehicle verdict

> **Status: research complete → implementation spec is `NATIVE_ALARM_SPEC.md`.** This doc records
> *why* the native path is Capacitor and captures the mid-2026 platform research (AlarmKit, Android
> exact-alarm/full-screen-intent policy, the Capacitor alarm-plugin survey). For the actual
> phase-by-phase build read **`NATIVE_ALARM_SPEC.md`**. Background: `NOTIFICATIONS.md` §3b (why the
> web app can't ring a closed-app alarm), `FRONTEND.md` §9 (the web alarm UI), `PRAYER_ENGINE.md`.

---

## 1. Goal (unchanged)

A real prayer alarm that rings the user's chosen tone at the exact prayer time, full-screen, **while
the phone is locked and the app is fully closed** — like the OS clock's alarm — on Android and iOS,
**and fully offline** after a one-time online location setup. Approach: wrap the existing React SPA
in **Capacitor** and add a thin native layer that schedules **on-device local alarms** and computes
prayer times on-device (reusing the engine verbatim). No dependence on a live server push.

## 2. Why the web build can't (recap)

A closed PWA runs no code; the only wake path is a **server Web Push** that lets the service worker
show a **notification** — which uses the **system** sound, can't play our MP3, can't take over the
screen, and can't auto-launch the app. Identical on iOS and Android; not fixable in the web layer.
**Notification Triggers** (the one web API that scheduled local notifications) was **formally
abandoned by Chrome** and never shipped anywhere; there is no 2026 successor. **PWA-only is a dead
end** — confirmed.

## 3. Vehicle verdict — Capacitor wins (research, mid-2026)

Ranking for "add true closed-app custom-tone alarms to an existing React 19 SPA at lowest cost":

1. **Capacitor wrap + a bespoke native alarm plugin** ✅ — keeps `client/` verbatim; the native
   alarm work (Kotlin `AlarmManager`/full-screen-intent; Swift AlarmKit) is required in *every*
   vehicle, so it is **not** a Capacitor-specific cost. Capacitor imposes no capability ceiling
   (plugins are thin bridges to arbitrary native code).
2. **React Native / Expo rebuild** — real alarm libs now exist on both OSes, but a full UI rewrite
   throws away the Tailwind/React/RTL SPA. Churn signal: Notifee (the go-to RN full-screen-intent
   lib) was **archived April 2026**.
3. **Flutter rebuild** — the `alarm` pub package is the most purpose-built, but same full-rewrite
   cost, and its pre-AlarmKit iOS path is a **silent-audio hack** (unreliable after termination).
4. **KMP / native twins** — highest cost, zero SPA reuse; our compute already lives in a reusable
   engine, so KMP's shared-core value is largely moot.
5. **PWA-only** — impossible (above).
6. **TWA / Bubblewrap** — Android-only, and can't bundle custom native code without abandoning the
   thin-wrapper premise.

Cross-cutting: the native alarm/Doze/full-screen mechanics are an **OS + store-policy** problem,
identical regardless of wrapper — so the only real variable is "do you *also* eat a UI rewrite."
For a solo maintainer with a working SPA, Capacitor is the clear choice. App-Store 4.2
(minimum-functionality) risk for webview wrappers is real but mitigated by genuine native-feature
integration (a true AlarmKit alarm is exactly that); keep the PWA as the iOS fallback.

## 4. iOS — AlarmKit (iOS 26) is the pivotal 2026 fact

Apple shipped **AlarmKit** in iOS 26 (WWDC 2025): third-party apps get **Clock-app parity** —
full-screen lock-screen alarm, **rings through Silent mode and Focus/DND**, custom bundled sound,
native stop/snooze, Dynamic Island — **with no special entitlement**. Only requirements:
`NSAlarmKitUsageDescription` in Info.plist + a runtime authorization prompt.

- **There is NO `com.apple.developer.alarmkit` entitlement.** A widely-copied claim that you must
  "apply through the Developer portal" is wrong; an Apple DTS engineer confirmed the entitlement
  doesn't exist (it originated as an LLM-hallucinated `entitlements.plist` entry that broke builds).
  **Do not add it.**
- **Custom sound:** file in the app bundle / `Library/Sounds`, **≤ ~30 s**. Looping of *custom*
  sounds was flaky before **iOS 26.1** (default sound looped fine) — verify on device.
- **Scheduling:** use per-prayer **`.fixed(Date)`** one-shot alarms (prayer times shift daily; don't
  rely on `.relative` recurrence). **No "cancel all" API** — track alarm IDs yourself. No published
  count cap (unlike the 64-notification cap).
- **Adoption:** iOS 26 was on **~79% of active iPhones** by June 2026 (Apple's own figure). Fallback
  for iOS < 26 = `UNUserNotificationCenter` local notifications with `.timeSensitive`.
- **Critical Alerts entitlement — dropped.** Still manually Apple-reviewed and skewed to
  health/safety; unproven for prayer apps; needs push infrastructure + a custom Capacitor plugin.
  AlarmKit supersedes its use case on iOS 26+ without the approval gate.
- **Gotchas:** a Live Activity/widget extension is only needed for *countdown-mode* alarms (we use
  fixed → not needed); Simulator sound is unreliable (test on hardware); the API is verbose
  (AlarmButton → AlarmPresentation → AlarmAttributes → AlarmConfiguration → schedule).

## 5. Android — mechanics confirmed, two Play-policy caveats

- **`AlarmManager.setAlarmClock()` is the gold standard** and **Doze-exempt** (the system leaves Doze
  shortly before it fires). This is unchanged through Android 16.
- **Exact alarms:** `USE_EXACT_ALARM` auto-grants only to apps whose *declared Play "core
  functionality"* is alarm/calendar; a prayer app may not qualify. **Primary path:** declare
  `SCHEDULE_EXACT_ALARM`, check `canScheduleExactAlarms()`, and prompt via
  `ACTION_REQUEST_SCHEDULE_EXACT_ALARM`. Gotcha: if the user later revokes it, the OS **deletes**
  scheduled alarms → re-check on every app open.
- **Full-screen intent:** since Android 14 (Play-enforced Jan 2025) `USE_FULL_SCREEN_INTENT`
  auto-grants only to declared alarm/calling apps; otherwise Play revokes it at install. **Must**
  runtime-check `NotificationManager.canUseFullScreenIntent()` and deep-link
  `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`; degraded path = a 60-s heads-up notification (tone
  still plays via our foreground service).
- **Android 15:** a `mediaPlayback` foreground service **cannot** be started directly from
  `BOOT_COMPLETED` — the boot receiver only re-arms `AlarmManager` (which is all it should do).
- **OEM battery killers** (Xiaomi/HyperOS, Samsung, Huawei) still defer alarms. Ship the
  Play-approved `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` prompt + a dontkillmyapp-style OEM notice +
  an expectations banner. HyperOS resets the exemption after updates — warn users.

## 6. Plugin survey — no usable off-the-shelf option → custom plugin

Fresh npm/GitHub survey (2026-07): **no mature community Capacitor plugin delivers the full stack**
(exact schedule + full-screen lock activity + boot re-arm + looping custom tone).
- `@capgo/capacitor-alarm` — the only actively-maintained one, but it just **hands off to the OS
  Clock app** (no custom in-app UI/tone). Unusable for a branded alarm.
- `@capacitor/local-notifications` (official) — exact scheduling only; **no** full-screen intent,
  **no** boot re-arm, custom sound is channel-bound (immutable per channel). Insufficient.
- Others (`go-u/…`, `BazuMax/…`, `NePheus/capacitor-fullscreen-notification`) — abandoned, immature,
  or push-triggered-only.

Open-source prayer apps converge on **native alarm code even when the UI is hybrid** (Al-Azan used
RN + a *forked* native notification lib, then moved toward native Compose; Muezzin is native Java
with a boot receiver). Conclusion: **write one small app-local `PrayerAlarm` plugin** (Kotlin now,
Swift/AlarmKit later) — detailed in `NATIVE_ALARM_SPEC.md`.

## 7. Constraints that shaped the spec

- **User has no Mac and no Apple Developer account** → **Android first via Play Store** ($25); iOS is
  deferred to a later phase built on cloud macOS CI.
- **Audience is Iraq-centric (~95% Android)** → Android delivers almost all the value first.
- **Must work fully offline** → the native app computes times on-device (engine reused verbatim; no
  `anchors` server endpoint) and schedules a 7-day local horizon; network is used only for the
  first-run/location-change geo lookups.

→ **Implementation: `NATIVE_ALARM_SPEC.md`.**
