# Feedback Round 2 — task board (v2.1.0 · versionCode 4)

APK-feedback round, **2026-07-22**, on `feat/v2-redesign`. Durable knowledge has been folded into
the topic docs (links per phase); this file is the session tracker.

Source feedback (user, on the vc3 sideload): remove the default 10-min notification · alarm must not
be closable/swipe-away-able until properly dismissed · compass+masjids laggy, must refresh on
re-entry + pull-down, broken on Galaxy A70/A21, row redesign · glass tab bar off and not frosty.

## Phase 1 — remove the seeded 10-min default rule ✅
- [x] `local-alerts-store.ts`: seeder → `migrateRemoveSeededDefault()` (exact-match only)
- [x] `App.tsx` + `NativeReminders.tsx` + web `NotificationsOptIn.tsx` equivalent
- [x] tests rewritten (13 green) · **verified on the user's Pixel: reminders list is now empty**

## Phase 2 — alarm hardening ✅ (built; on-device ring test still owed)
- [x] `AlarmActivity`: BACK consumed via `OnBackInvokedCallback` (API 33+) **and** `onBackPressed()`
- [x] tap-to-stop removed — only the ≥90 dp swipe dismisses; TalkBack-only click kept for a11y
- [x] `AlarmService`: `setDeleteIntent` → `ACTION_REPOST` re-posts a swiped-away notification
- [x] `App.tsx`: hardware BACK no longer dismisses the web alarm overlay
- [ ] **owed:** fire a real alarm on-device (shell cannot launch the non-exported AlarmActivity)

## Phase 3 — compass sensor fallback ✅
- [x] chain `ROTATION_VECTOR` → `GEOMAGNETIC_ROTATION_VECTOR` → accel+magnetometer
- [x] accel+mag accuracy capped at "medium"; `source` emitted and shown in the 5-tap diagnostic
- [ ] **owed:** A21/A70 confirmation (gyro-less device not in hand)

## Phase 4 — perf ✅
- [x] heading out of React state (`subscribe`/`getHeading`), one rAF loop, transforms written direct
- [x] 200 ms CSS transitions removed from the ~30 rotating nodes; masjid arrows ~10 Hz imperative
- [x] `lib/heading-anim.ts` + tests — **caught a real bug**: JS `%` on a drifted continuous angle
      returned −350° instead of +10°, i.e. the dial would spin the long way round

## Phase 5 — GPS + refresh ✅
- [x] `hasGeolocationPermission()` (checks, never prompts) → Times tab auto-fixes when already granted
- [x] `requestGpsStaged()` — fast cached fix first, high-accuracy refine after (only re-publishes on a
      grid-cell change) · **on device the list now appears by itself, no button tap**
- [x] refetch on tab re-entry (grid-cell signature) + `PullToRefresh` (+ pure state machine & tests)
- [x] errors moved into the section body with a retry button

## Phase 6 — server travel times + embed key ✅ DEPLOYED
- [x] `places/google-routes.ts` (computeRouteMatrix WALK+DRIVE, zod-parsed, never throws)
- [x] merged into the 24 h grid cache; budget breaker now counts 3 units/miss; only the 5 rendered
      rows are priced (Routes bills per element)
- [x] `GOOGLE_MAPS_EMBED_KEY` → response `embedKey`; server tests green (30)

## Phase 7 — masjid row redesign ✅
- [x] Maps/Waze chips out of the row → row expands with a **live Google directions map** + the buttons
- [x] travel-time subtext with correct Arabic number agreement (دقيقة / دقيقتان / دقائق)
- [x] `MarqueeText` for long names (measures overflow; reduced-motion → truncate)
- [x] expanding scrolls the panel clear of the tab-bar overlay

## Phase 8 — glass tab bar ✅
- [x] **Root cause of "no frosting": the built CSS emitted only `-webkit-backdrop-filter`** — see
      `docs/FRONTEND.md` §13. Glass had NO blur on Android at all.
- [x] safe-area inset moved from inner padding to margin on floating themes (the dead band)
- [x] glossy recipe: flat 0.16 fill, 4 px blur, wide-band lens, specular sheen, softer active pill
- [x] labels 11 → 12.5 px, icons 19 → 21 px

## Phase 9 — release/docs
- [x] versionCode 4 · CHANGELOG · FRONTEND §13 · QIBLA_MASJID_SPEC · NOTIFICATIONS · NATIVE_ALARM_SPEC
      · DECISIONS ADR-013 · OPERATIONS (keys/project)
- [x] **SUBMITTED TO PLAY 2026-07-22**: signed AAB `D:\keys\releases\prayer-v2.1.0-vc4.aab`
      uploaded to **Closed testing - Alpha** as release `4 (2.1.0)`, Arabic release notes attached,
      sent for review (177 countries; status "In review"). Previous track release was `3 (2.1.0)`.
      Only warning: no deobfuscation mapping (the app isn't minified) - same as prior releases;
      device support unchanged (0 devices lost).
- [ ] merge `feat/v2-redesign` → `main` (still open from v2.0.0)

## Verification status
- [x] client build + 149 client tests · server typecheck + 30 places tests
- [x] engine gate: `astronomy` appears only in the lazy native chunk (dynamic import, not preloaded)
- [x] **deployed to production** (travel times + embedKey verified live)
- [x] on-device: masjid list auto-loads, travel times, embedded map, refresh, glass rendering
- [ ] alarm ring on device · pull-to-refresh gesture on device · A21-class compass

## Still owed / human tasks
- Remove the user's home IP from the Places key allowlist (currently **Application restrictions =
  None** on "API key 4" — worth tightening to the VPS IP).
- Nothing further for Play: Google review typically completes within ~7 days, then testers get it.
- The 14-day continuous closed-testing clock for production access stood at 2 days; this release does
  not affect it (the counter tracks testers opted in, not uploads).
