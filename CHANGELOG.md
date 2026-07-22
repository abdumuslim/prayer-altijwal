# Changelog

All notable changes to the prayer-times app (web + Android). Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/)
from 2.0.0 (client `package.json` is the source of truth; Android `versionName` mirrors it,
`versionCode` increments by 1 on every Play upload — `docs/V2_REDESIGN_SPEC.md`, ADR-008).

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
