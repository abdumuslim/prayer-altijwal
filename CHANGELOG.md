# Changelog

All notable changes to the prayer-times app (web + Android). Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/)
from 2.0.0 (client `package.json` is the source of truth; Android `versionName` mirrors it,
`versionCode` increments by 1 on every Play upload — `docs/V2_REDESIGN_SPEC.md`, ADR-008).

## [2.6.1] - 2026-10-19 (versionCode 13)

### Removed
- **The Waze button is gone from «أقرب المساجد».** An expanded masjid row now shows the directions
  map with a single Google Maps button.

### Fixed
- **The website's qibla compass now reads correctly with the phone held flat** (Android Chrome). It
  used the direction the back of the phone faces, which points at the floor when the phone lies flat,
  so a few degrees of tilt swung the needle by 90° or more. It now follows the top edge of the screen
  (in landscape too), the same reading the Android app's native compass uses; with the phone held
  nearly upright it keeps the last direction and asks to hold the phone flat instead of guessing.
  The Android app's compass is unchanged by this
  fix (a separate report about it is open, `docs/QIBLA_MASJID_SPEC.md`).

## [2.6.0] - 2026-08-26 (versionCode 12)

### Changed
- **«أقرب المساجد» (nearest masjids) is now shown only inside Iraq.** The resident masjid dataset
  covers Iraq, so for a location outside it the section is hidden entirely; the qibla compass, prayer
  times, reminders, and everything else stay available everywhere. The server now also refuses masjid
  requests for coordinates outside Iraq, so no lookup can run for a location the dataset cannot answer.

### Added
- **Crashes and unexpected errors are now captured on the device.** A small local error log records
  failures so an issue can be diagnosed from the app itself instead of a blank screen.
- **Alarm scheduling is now observable.** How many alarms are held against the platform's limit is
  recorded, so a phone approaching that cap can be spotted before an alarm is silently dropped.
- **Nightly server backups and log rotation.** A scheduled backup of the prayer database and rotation
  of the container logs keep the deployment recoverable and bounded on disk.

### Security
- **A security and abuse-hardening round across the backend.** The push endpoints now accept only the
  known reminder fields (a strict allowlist), the public endpoints are rate-limited, and the daily
  retention sweep prunes the usage and demand tables to their intended lifetimes so nothing
  accumulates without bound.
- **Android auto-backup of the app's data is turned off** (`allowBackup=false`), so reminder and alarm
  state is not copied off the device by the platform's cloud backup.

## [2.5.0] — 2026-08-25 (versionCode 11)

### Added
- **A missed alarm now shows a notification** instead of disappearing silently: whether it rang out
  without being stopped, was skipped as stale, or was found expired-but-unfired at re-sync, the app
  posts a «فاتك منبّه …» notice.
- **Every alarm now gets a dismiss notification about 30 minutes early.** It carries an «إيقاف المنبّه»
  button that turns off that one occurrence without opening the app, and the dismissal is remembered so
  a later re-sync cannot re-arm it.

### Fixed (full alarm-reliability audit, `docs/NATIVE_ALARM_RELIABILITY_SPEC.md`)
- **Alarms now survive a reboot that happens before the first unlock.** A direct-boot-aware fire/boot
  chain, backed by device-protected storage, means a night-time auto-restart can no longer silently kill
  the Fajr alarm.
- **A missing exact-alarm permission no longer throws and aborts the whole set.** Scheduling falls back
  to inexact alarms with per-alarm fault isolation and a 500-alarm cap, and a refused foreground-service
  start degrades to an audible notification instead of silence.
- **Re-arming is more thorough.** It now also runs when the exact-alarm permission is re-granted and via
  a daily self-check alarm; a thinning 7-day horizon posts a quiet «حدّث منبّهات الصلاة» nag; and
  alarm-store writes are durable and serialized.
- **The JS scheduler is hardened.** One bad day no longer drops the whole 7-day horizon, DST transitions
  no longer skip or duplicate a day, a stale in-flight sync can no longer overwrite a newer one, and a
  failed sync retries.

## [2.4.0] — 2026-08-12 (versionCode 10)

### Changed
- **Prayer times at every Iraqi governorate capital now match the official ديوان الوقف السني poster to
  the minute across the whole year.** The app ships the full 2025-08→2026-08 official table (every cell
  image-verified against the year's poster photos), and dates beyond it reuse the same calendar day from
  the most recent covered year — which is the Waqf's own practice when it misses a day. This removes the
  ±1–2-minute maghrib/isha drift on dates the old 35-date table didn't cover. Genuine misprints found in
  ~30 official cards (wrong-day tables, shifted/duplicated columns, two Baghdad hero typos) are detected
  and never served; eleven 1-minute transcription errors in the app's 19-June-2026 reference poster were
  also found and fixed. Full audit trail: `server/data/waqf-archive-adjudications.json`,
  `docs/DECISIONS.md` ADR-017.

### Fixed
- **The nearest-masjid card no longer shows a raw Google error** when opening the directions preview for
  a masjid whose Google listing changed — the preview now always targets the masjid's coordinates.

## [2.3.0] — 2026-07-26 (versionCode 9)

_Retroactive entry — this release shipped without a changelog entry._

### Added
- **Anonymous daily usage ping** (rotating daily key, no identifiers or account) that powers the
  operator dashboard's audience view, and support for a remote kill-switch so a defective release can be
  asked to update. Detail: `docs/ADMIN_DASHBOARD.md`.

## [2.2.0] — 2026-07-25 (versionCode 8)

### Added
- **«أقرب المساجد» now works offline and without spending API quota.** A resident masjid dataset for
  Iraq (9,835 entries from OpenStreetMap, ODbL) ships with the app's backend, so in any well-mapped
  area the list is answered locally — no Google call at all. Where the local data is thin (rural
  areas, mapping gaps) Google is still queried, and the two sources are merged rather than one
  replacing the other.
- **Users can add a masjid they know** («أضف مسجداً») at their current position. The contributor sees
  it in their own list immediately; everyone else sees it once it is reviewed. Contributions must be
  the user's own knowledge — copying from Google Maps is explicitly asked against, and is what would
  make the dataset unusable.
- **The list is kept on the device**, so re-opening the app paints instantly and a phone with no
  connection still shows the last known masjids.

### Changed
- **Walking/driving times in the list are now estimates** («نحو 6 دقائق مشيًا»), calculated from
  distance. Tapping a masjid open fetches the real routed time for that one. This was the single
  change that mattered most for cost: pricing all five visible rows on every lookup was consuming ten
  billed routing elements at a time and capped the whole feature at roughly 1,000 lookups a month.
- **The list no longer re-fetches as you move around** — only when you open the tab and when you pull
  down to refresh. Distances and the direction arrows still track your position live.
- Masjid data is credited under the list, as OpenStreetMap's licence requires.

### Fixed
- A redeploy no longer discards the cached masjid data, and results are now shared correctly between
  people in the same neighbourhood instead of being re-bought per person.

Full rationale — including why the masjid data could not simply be copied from Google, and how the
spending limits pace themselves — in `docs/DECISIONS.md` ADR-014 and `docs/QIBLA_MASJID_SPEC.md` §6d.

## [2.1.2] — 2026-07-24 (versionCode 7)

### Fixed
- **«أقرب المساجد» no longer fails with an error on the first visit.** The list waits for a real GPS
  fix, and on a cold device (no recent fix, GNSS cold or indoors) both staged location attempts could
  time out before one landed — so the section showed a location error instead of the mosques, then
  quietly started working once any fix arrived. It now paints from the **last known position first**
  (the list appears almost immediately whenever the phone has any recent fix), falls back to a
  **patient coarse attempt** on a genuinely cold device, and refines to a precise fix **silently** in
  the background — a slow precise lock can no longer flash a stale error over a list that is already
  correct. The mosque fetch also **retries once** on a transient network hiccup before showing an
  error. (Diagnosed live on a tester's Samsung; Samsung Auto Blocker was investigated and ruled out —
  the cause was this cold-fix race. New unit-tested `lib/gps-staging.ts`; behaviour-only, no text
  changes.)

## [2.1.1] — 2026-07-23 (versionCode 6)

### Removed
- **The monthly table is gone from the app.** It had been open by default since 2.1.0, so every
  visit to that tab rebuilt a whole month — on the phone, the engine computing ~30 days offline and
  ~30 rows rendered — for a feature that went unused. The server endpoint
  (`GET /api/prayer-times/month`) is untouched, so restoring the table is a revert.

### Changed
- The second tab is now **«الاتجاهات»** with a compass icon (was «المواقيت» with a calendar): with
  the table gone it holds the qibla compass and the nearest masjids, nothing about times.

### Fixed
- **The ringing alarm screen no longer disappears when you unlock the phone.** Its full-screen intent
  carried `FLAG_ACTIVITY_NO_HISTORY`, which finishes the screen the moment you navigate away from it
  — and on a gesture-navigation phone the swipe used to unlock *is* the home gesture, so Android
  destroyed the alarm screen for good while the tone kept playing with no visible way to stop it. The
  screen now survives the unlock and puts itself back in front while the alarm is still ringing, and
  is closed deliberately when the ring ends (Stop, the 2-minute cap, or the service timeout).
- A second alarm firing while the ring screen is still up now shows the new prayer instead of the
  previous one.

## [2.1.0] — 2026-07-22 (versionCode 4)

Second sideload-feedback round. Reminders, alarm safety, the masjid section and the glass tab bar.

### Added
- **Nearest masjid: walking + driving times** from the Google Routes API, shown after the distance
  with correct Arabic number agreement (دقيقة / دقيقتان / دقائق).
- **Expandable masjid rows** with an embedded Google directions map (device → masjid); the Maps and
  Waze buttons moved inside the expanded panel.
- **Marquee** for masjid names too long for their row; **pull-to-refresh** on the Times tab, and the
  masjid list now also refreshes when you return to the tab.
- Compass falls back to the geomagnetic rotation vector, then accelerometer+magnetometer, so
  gyro-less phones get a working dial instead of a static one.

### Changed
- **No default reminder is created any more**; a one-time migration removes the old seeded 10-minute
  rule from existing installs (only if it was never edited).
- GPS for the masjid list is staged — a fast fix paints the list, a precise fix refines it — and runs
  by itself when permission was already granted.
- Glass tab bar: glossy translucent capsule with real refraction, larger labels, and the safe-area
  inset no longer inflates it with empty space.

### Fixed
- **The alarm can no longer be closed by accident**: the back gesture is ignored, a stray tap no
  longer stops it (only the deliberate swipe does), and swiping its notification away re-posts it
  while it is still ringing.
- **Glass had no blur at all in the Android app** — the build was emitting only the obsolete
  `-webkit-backdrop-filter` (docs/FRONTEND.md §13).
- The Times tab no longer re-renders ~20×/s off the compass sensor (the "laggy" report), and the
  dial can no longer spin the long way round after drifting past a full turn.

## [2.1.0] — 2026-07-19 (versionCode 3)

Real-device (Pixel) feedback round on the v2 APK: layout, navigation, compass and nearest-masjid
fixes plus a non-color glass design/motion pass. Web + native; the signed AAB upload stays the
last human step.

### Added
- **Swipe navigation** — a finger-following animated pager slides between the four tabs (RTL-aware:
  drag toward a tab's side brings it in). Vertical scrolling and the month table are never hijacked;
  dead while an overlay is open; respects reduced-motion. Hardened in review: a browser-cancelled
  gesture (scroll/pinch/system) springs back instead of committing, a second finger can't hijack a
  drag, fractional-width viewports don't leak a sliver of the neighbouring tab, and pinch-zoom
  stays available. Device rounds 2–3 (real-Pixel dispatch-log debugging): the pager's own page
  column is excluded from the gesture guard (textZoom overflow made it reject drags), and — the
  decisive fix — `touch-action: pan-y` moved onto the page scroll column itself (the element the
  finger lands on; on the viewport alone the WebView cancelled every horizontal drag ~15px in)
  plus native `setOverScrollMode(OVER_SCROLL_NEVER)`. Swipe verified working on the Pixel 7 Pro.
- **Native geolocation** — `@capacitor/geolocation` + `ACCESS_FINE/COARSE_LOCATION`, so the
  nearest-masjid GPS opt-in actually works in the APK (the WebView could not obtain a fix before);
  the OS remembers the grant (asked once). A denied/failed request now shows a message instead of
  doing nothing.
- Per-prayer fard check-in icons on the **Home** prayer strip (moved from the Times tab).
- Tactile press-feedback micro-interactions across the hero widgets, chips and buttons; a Home
  entrance cascade; theme-gallery card animations.

### Changed
- **Nearest-masjid list excludes non-mosque venues** (server-side, by name — user rule): all
  husseiniya spellings (حسينية/حسينيه/حسينة + Persian-script حسینیه + transliterations, including
  combined «مسجد وحسينية …»), موكب stations and مضيف halls. Hussein-named mosques and shrines
  (جامع الإمام الحسين، مرقد الامام الحسين) are kept. Live-verified against Karbala city centre.
- **Monthly table opens expanded by default** on the Times tab (was collapsed; its request still
  fires only while the tab is shown).
- **Compass redesign** — cardinal letters stay upright (no longer rotate/tilt — including during
  the smoothing spring, fixed in review), a clear arrow
  needle with the Kaaba at its tip replaces the mosque chip, the center degrees readout is removed,
  a larger dial, and it **auto-starts** (no button / no repeated permission) except on iOS-web.
  The native accuracy chip is now **honest**: it merges the rotation vector's own per-event heading
  uncertainty (±rad estimate) with the sensor status, so a magnetically disturbed device shows
  «بحاجة إلى معايرة» + the figure-8 hint instead of a false «دقة عالية» (a real Pixel 7 Pro
  measured 171 µT ambient vs Earth's ~47 µT with ±90° heading uncertainty — no compass app can
  point right there; the app now says so).
- Home hero: main ring 172→184 px (no text/ring overlap); the score+streak badge moved to the
  hero's bottom-center under the check-in box; corner rings raised so the check-in box never
  overlaps them; prayer-strip time size increased.
- Times tab: the duplicate today strip was removed (compass is first).
- **Glass theme design pass (no color change)**: squircle cards + deeper "floating glass" depth.
- Bottom tab bar raised and hardened against the Pixel gesture bar — safe-area insets now resolve
  via CSS `env(safe-area-inset-*)` with the Capacitor-injected value as a `max()` fallback.
  Device round 2: Capacitor 8.4.1's conditional inset pipeline still left the WebView under the
  gesture bar with zero-valued vars on the Pixel, so `MainActivity` now owns the insets
  deterministically — always edge-to-edge, always injecting the real system-bar insets (no WebView
  version gate, no async viewport probe).

### Removed
- The in-app font-size setting (it broke layouts). The independent Android system-font-scale
  compensation (`data-syszoom`, WebView textZoom ≤130%) is kept.

## [2.0.0] — 2026-07-14 (versionCode 2)

Web half deployed to https://prayer.altijwal.com; signed Android AAB packaged for the existing
closed track (upload/rollout is the last human step). P9 home-screen widget deferred to v2.1.

### Added
- 4-tab bottom navigation — الرئيسية · المواقيت · التقارير · الإعدادات — replacing
  the slide-over panels (real-app navigation on web and Android alike).
- Theme gallery of distinct design languages: الليل (default) · Liquid Glass (luminous light) ·
  Material (M3 dark from the brand teal seed) · high-contrast, runtime-switchable, persisted.
- Dedicated Reports page (التقارير): today ring + category bars, trend chart (أسبوع/شهر/أشهر),
  62-day heatmap, per-prayer breakdown, lifetime totals — replaces the stats bottom sheet.
- Monthly prayer-times table (server `GET /api/prayer-times/month`; computed
  offline on Android) — now collapsed by default inside المواقيت.
- Qibla compass (اتجاه القبلة) in المواقيت: true-north heading via the fused native sensor
  (Android) or absolute web orientation + WMM-2025 declination (`GET /api/geo/declination`);
  ±3° gold lock-on with haptic; honest static-guidance mode when no absolute sensor exists.
- Nearest masjids (أقرب المساجد): closest mosques around a real GPS fix via a server-side
  Google Places proxy (`GET /api/places/masjids`, key never in the client), with distance,
  live bearing arrows and Google Maps / Waze deep links.
- Accessibility package: axe-clean WCAG-AA contrast in all four themes (glass accents
  re-derived, contrast theme colorblind-safer proximity split), token-driven focus rings,
  ≥48 px touch targets, ARIA sweep (stable names for ticking countdowns, dialog focus
  management, live-region check-in confirmations), extended reduced-motion, in-app font-size
  setting with a no-clip re-tune at أكبر, Android system font scale (capped 130%).

### Changed
- Semantic versioning adopted; app version surfaced in Settings → About.

### Security
- Places proxy: global per-minute upstream budget breaker + `rel="noopener noreferrer"` on
  masjid deep links (pre-release security review; ADR-011). Maps key server-only, never in the
  client/logs/error responses.

### Deferred to v2.1
- Android home-screen widget (next prayer + live countdown).

## [1.0] — 2026-07 (versionCode 1)

First Google Play release (closed testing): live prayer times with calibrated Iraqi (Waqf)
profile, hero countdown ring with Duha/Qiyam satellites and iqama bar, worship tracker
(opt-in), web-push + native offline full-screen alarms, city search + governorate quick-pick,
Arabic RTL UI. Web app live at https://prayer.altijwal.com.
