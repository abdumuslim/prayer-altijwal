# Native Alarm Plan (Capacitor) — future work

> **Status: PLAN ONLY — not implemented.** The shipped web app cannot ring a true alarm while the
> app is closed (see `NOTIFICATIONS.md` §3b + `FRONTEND.md` §9). This doc scopes a **native wrapper**
> that would. Read `NOTIFICATIONS.md` (push pipeline), `PRAYER_ENGINE.md` (time computation), and
> `FRONTEND.md` (the web alarm UI we reuse) before implementing.

---

## 1. Goal

Ship a **real prayer alarm** that rings the user's chosen tone, at the exact prayer time, **while the
phone is locked and the app is fully closed** — like the OS clock's alarm — on both **Android** and
**iOS**, without rebuilding the app. Approach: wrap the existing React SPA in **Capacitor** and add a
thin native layer that schedules and fires **on-device local alarms** (no dependence on a live server
push). The web UI, prayer engine, worship tracker, and web push all stay; the native build simply adds
the one capability the web platform denies.

## 2. Why the web build can't (recap)

A closed PWA runs no code; the only wake path is a **server Web Push** that lets the service worker
show a **notification** — which uses the **system** sound, can't play our MP3, can't take over the
screen, and can't auto-launch the app. This is identical on iOS and Android and is not a bug we can
fix in the web layer. A native app gets **OS alarm/notification scheduling** that runs locally and
survives app-close and reboot. (Notification Triggers, the one web API that scheduled local
notifications, was never shipped to stable and is absent on iOS — not viable.)

## 3. Architecture — Capacitor hybrid

```
┌───────────────────────────── Native shell (Capacitor) ─────────────────────────────┐
│  WKWebView (iOS) / Android System WebView                                           │
│    → the SAME React SPA (client/), built by `vite build`, loaded from the bundle    │
│    → computes prayer times locally (reuse prayer-engine) and, when times change,    │
│      hands the next N fire-instants to the native alarm plugin over the JS bridge   │
│                                                                                     │
│  Native plugins                                                                     │
│    • Local-notifications / alarm scheduler  ← the new capability                    │
│    • Filesystem/assets for the bundled alarm tones                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
        Android: AlarmManager + full-screen-intent Activity + BootReceiver
        iOS:     UNUserNotificationCenter local notifications (+ critical-alert entitlement)
```

**What stays web (reused verbatim):** the whole UI (`client/src/**`), i18n, worship tracker, the
`AlarmOverlay` (shown when the app is foregrounded by the alarm), the location flow, and the
`prayer-engine` time computation (runs in the webview — it is pure JS + `astronomy-engine`). Web push
(`server/`) is kept for desktop/uninstalled users; native builds prefer local scheduling.

**What is new (native):** a scheduler that turns "the next few days of prayer instants" into OS-level
alarms, plus the platform glue to make them ring full-screen with our tone.

## 4. Scheduling model — local, on-device (recommended)

Do **not** depend on the server push for the native alarm. Instead:

1. The webview computes the prayer table for the resolved location (reuse `calculatePrayerTimes`,
   the calibration, sunnah windows — exactly as the web app already does).
2. On each recompute (location change, daily rollover, app open), the JS calls the plugin to
   **(re)schedule the next ~48–72 h** of enabled alarm instants (respecting the user's alert rules —
   which prayers, `kind === 'alarm'` only, offsets). iOS caps pending local notifications at **64**, so
   cap the horizon and top up on every app open + a daily background refresh.
3. Native fires the alarm even if the app never opens again in that window.
4. **Reschedule on reboot** (Android `BOOT_COMPLETED` receiver; iOS reschedules on next app open —
   iOS clears nothing on reboot but can't run on boot, so keep the 64-slot horizon populated).

Rationale: exact-time, offline, no server round-trip, no push-delivery flakiness. The server push
path remains for the web/PWA audience and as a redundant nudge.

## 5. Platform mechanics

### Android
- **Exact scheduling:** `AlarmManager.setAlarmClock()` (preferred — shows the system alarm icon and is
  exempt from Doze) or `setExactAndAllowWhileIdle()`. Requires `SCHEDULE_EXACT_ALARM` /
  `USE_EXACT_ALARM` permission (Android 12+/13+).
- **Ring full-screen over the lock screen:** a **full-screen intent** notification
  (`setFullScreenIntent`) launching a native `AlarmActivity` with `USE_FULL_SCREEN_INTENT` permission,
  `setShowWhenLocked` / `setTurnScreenOn`. The Activity can just load the web `AlarmOverlay` route, or
  be a thin native screen — decide in impl.
- **Custom sound + loudness:** a dedicated **notification channel** with the bundled tone as its sound
  (channel sound is immutable once created — version the channel id if tones change), or play the tone
  via a foreground `Service` + `MediaPlayer` (loop for 2 min) so we control volume/stop, matching the
  web overlay's behavior.
- **Reboot:** `BootReceiver` (`RECEIVE_BOOT_COMPLETED`) re-arms the alarms.
- **Battery-optimization:** prompt to exempt the app (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) for
  reliability on aggressive OEMs (Xiaomi/Huawei/etc.).

### iOS
- **Local notifications:** `UNUserNotificationCenter` with `UNCalendarNotificationTrigger` per prayer
  instant; attach the bundled tone via `UNNotificationSound(named:)` (tone files must be **≤ 30 s** and
  in the app bundle — trim/prepare them). Max **64** pending — schedule the nearest 64, top up on open.
- **Ring through silent mode / DND:** requires the **Critical Alerts** entitlement
  (`UNNotificationSound.criticalSoundNamed`) — this needs an **Apple entitlement request/approval**
  ("com.apple.developer.usernotifications.critical-alerts") and a justification. Without it, an iOS
  alarm respects the ringer/DND like any notification.
- **No true full-screen takeover:** iOS cannot launch an arbitrary full-screen Activity from the
  background like Android. The best is a rich notification (+ optional Notification Content Extension);
  tapping it opens the app into `AlarmOverlay`. The "ring" is the notification sound (looping requires
  a long/critical sound or stacked notifications — accept the platform ceiling).
- **Background top-up:** `BGAppRefreshTask` to keep the 64-slot horizon filled; still schedule
  generously on every foreground.

## 6. Plugin choice

Evaluate in this order (pick during a spike):
1. **`@capacitor/local-notifications`** (official) — cross-platform scheduling + custom sound + actions.
   Covers iOS fully and Android's basic case. **Gap:** Android exact-alarm + full-screen-intent lock-
   screen ringing is limited — likely needs a **small custom Capacitor plugin** for the Android
   `AlarmManager.setAlarmClock` + `AlarmActivity`.
2. **`@capacitor-community/*` alarm/exact-alarm plugins** — check maturity/maintenance before adopting.
3. **Custom Capacitor plugin** (`AlarmPlugin`) — the safe bet for Android's full-screen alarm; thin
   Kotlin/Swift exposing `schedule(instants, toneId)` / `cancelAll()`. iOS side can delegate to
   `UNUserNotificationCenter`.

Recommendation: **official local-notifications for iOS + a custom Android plugin** for the true
lock-screen alarm. Keep the JS API uniform (`nativeAlarm.schedule(...)`).

## 7. Reuse & shared code

- **Prayer engine:** runs in the webview unchanged — do **not** port it to native. The JS computes
  instants; native only schedules/fires. Keeps one source of truth (hard rule: reuse the engine).
- **Tones:** the same MP3s (`client/public/alarms/`) — for iOS bundle ≤30 s trims; for Android place
  in `res/raw` or play via the foreground service. Keep the `lib/alarm-sounds` catalog as the shared id
  list; map ids → native asset names.
- **Alert rules:** reuse the existing rule model (`kind`, targets, offsets). Native reads them (from
  the webview via the bridge) to know what to schedule. No server change required.
- **`AlarmOverlay`:** reuse as the in-app ringing screen when the app is foregrounded by the alarm.

## 8. Phased plan

1. **Spike (1–2 d):** add Capacitor to `client/`, build the SPA into an Android+iOS shell, load the
   live app, confirm the webview runs the engine and web push still works. No alarm yet.
2. **iOS local alarms:** `@capacitor/local-notifications`, schedule from the JS table, bundle trimmed
   tones, tap-to-open `AlarmOverlay`. (Defer critical-alerts entitlement to a later step.)
3. **Android exact alarm + lock-screen ring:** custom `AlarmPlugin` (`setAlarmClock` + full-screen
   `AlarmActivity` + foreground `MediaPlayer` loop 2 min + `BootReceiver`). Wire the same JS schedule.
4. **Robustness:** 64-slot top-up + `BGAppRefreshTask` (iOS); battery-optimization prompt + reschedule
   on boot/location/rule change (Android); dedup so native + web-push don't double-alert (prefer native
   when installed — suppress the server alarm push for native installs, or tag device platform on the
   subscription).
5. **Store prep:** Apple critical-alerts entitlement request (if pursuing DND bypass), exact-alarm
   permission rationale (Play), icons/splash, signing, privacy declarations. Publish to TestFlight /
   internal track.

## 9. Risks / caveats

- **Apple Critical Alerts** requires manual Apple approval; without it iOS alarms obey the ringer/DND.
- **iOS 64-notification cap** + no boot execution → the "always armed weeks ahead" guarantee is weaker
  than Android; mitigate with aggressive top-up on every open + background refresh.
- **Android OEM battery killers** can still delay things without the exemption prompt.
- **Two alert paths** (native local + server web-push) must be de-duplicated per device.
- **App-store overhead:** signing, review, entitlements, and ongoing native maintenance — a real cost
  vs. the current zero-install web app. Consider shipping native **only** for users who need the true
  alarm, keeping the web app as the default.
- **Engine in webview:** confirm `astronomy-engine` performance is fine inside WKWebView/Android
  WebView (it is pure JS; expected OK).

## 10. Acceptance criteria (when built)

- With the app **force-closed** and the **phone locked**, at a scheduled prayer instant:
  - **Android:** the screen turns on and a **full-screen alarm** rings the chosen tone for 2 min (or
    until dismissed); survives a reboot before the fire time.
  - **iOS (installed via TestFlight/App Store):** a notification fires with the chosen tone at the
    exact time; with the critical-alerts entitlement it rings through silent/DND; tapping opens the
    full alarm screen.
- Changing the tone / alert rules / location reschedules correctly; disabling alarms cancels them.
- Native and web-push do not double-alert the same device.
- The existing web app (browser + PWA) is unaffected — same codebase, `vite build` output.
