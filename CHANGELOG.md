# Changelog

All notable changes to the prayer-times app (web + Android). Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/)
from 2.0.0 (client `package.json` is the source of truth; Android `versionName` mirrors it,
`versionCode` increments by 1 on every Play upload — `docs/V2_REDESIGN_SPEC.md`, ADR-008).

## [2.0.0] — unreleased (versionCode 2)

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
- (in progress) Android home-screen widget: next prayer + live countdown.

### Changed
- Semantic versioning adopted; app version surfaced in Settings → About.

## [1.0] — 2026-07 (versionCode 1)

First Google Play release (closed testing): live prayer times with calibrated Iraqi (Waqf)
profile, hero countdown ring with Duha/Qiyam satellites and iqama bar, worship tracker
(opt-in), web-push + native offline full-screen alarms, city search + governorate quick-pick,
Arabic RTL UI. Web app live at https://prayer.altijwal.com.
