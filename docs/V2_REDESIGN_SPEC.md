# v2.0.0 Redesign Spec — tabs, theme gallery, reports, a11y, widget

> **Status (CHECKPOINT 2026-07-12, end of session 1): Phases 0–5 BUILT + user-reviewed on web;
> parts of 7/8 pulled forward. NEXT: Phase 6 (Reports tab).** Branch `feat/v2-redesign`
> (12 commits, `38c23db..a450f0c`). All gates green at checkpoint: client build + 89 tests,
> server 138 tests (8 new month tests), engine findstr gate, assembleDebug.
>
> **Done:** P0 versioning (2.0.0/versionCode 2, CHANGELOG, ADR-008) · P1 theme engine (token
> sweep, surfaces.css contract, pre-paint boot, reduced-motion, native setAppearance) · P2
> previews `?design=9/10/11` (approved; themes went through a replica-quality round after the
> first drafts were rejected as recolors) · P3 shell (App split into pages/, TabBar, keep-mounted
> tabs, tab-aware back, alarm-stop→Home) · P4 Home (3×2 PrayerStrip, ring 192→172 + h-5 spacer,
> no-scroll at 390×844+360×740) · P5 Times tab (shared `month-payload.ts` + `/api/prayer-times/month`
> + offline `native/month.ts` + MonthTable/MonthNav w/ Levantine month names; today section =
> strip WITH embedded check-ins — PrayerList/PrayerCard RETIRED) · pulled forward: Settings
> theme gallery + font-size control (`AppearanceSettings.tsx`), themed AlarmOverlay with the
> APK-matching countdown-to-adhan (+ `?a=` deep-link param, AlarmActivity appends it).
>
> **Session-1 user decisions (binding, not in the original spec):** themes must be replica-grade
> design languages (glass got vivid scene + multi-edge specular + capsule float; material got
> tonal blocking + tall nav; tightened glass shadows — no shadow bleed in card gaps) · active tab
> pill wraps icon+label · `kashi` lapis brand exploration exists as a 5th preview-only theme
> (styles/themes/kashi.css, NOT in the shipping registry — user hasn't decided) · alarm screens
> follow the theme AND show the countdown-to-adhan exactly like the APK's AlarmActivity (stacked
> gold label + MM:SS between clock and body) · stopping an alarm lands on Home · Times today
> section = compact strip with check-ins (vertical space is precious).
>
> **Remaining:** P6 Reports (deriveStats extensions + components — §Phase 6) · P7 theme polish
> (material Duha-disc tone split, glass refraction filter + perf pass, kashi decision, native
> AlarmActivity theming via AppearanceStore) · P8 a11y audit (ARIA sweep, ≥48px targets, axe
> contrast per theme, system font scale, TalkBack) · P9 widget · P10 docs sweep + closed-track
> upload · security review (task #12) · consolidated EMULATOR pass still owed: back-chain,
> airplane-mode month table, alarm `?a=` deep link, first-run flows.
>
> Written to be executed phase-by-phase by any implementer; each phase ends with commands that
> must pass. Read `FRONTEND.md` (v1 UI + gotchas), `PRAYER_TIMES_API.md`, `NATIVE_ALARM_SPEC.md`,
> `PLAY_RELEASE.md` first. v1.0 (versionCode 1) is live on the Play closed track — do not disturb
> it; v2 uploads as versionCode 2 to the same track when done.

## 1. Goal

Transform the v1 single-screen web-style app into **v2.0.0**, a real mobile-app experience served
by the same React client on web and in the Capacitor Android shell: a persistent 4-tab bottom
navigation (home clock · times · reports · settings) replacing slide-over panels; a
runtime-switchable **theme engine** whose themes are complete design languages (refined-night
default, an Apple-Liquid-Glass replica, a Google-Material skin, and a high-contrast accessibility
theme); a dedicated Reports page with substantially richer worship analytics (62-day heatmap,
per-prayer breakdown, trends, lifetime totals); a new monthly times table (server endpoint on web,
offline engine loop on native); an accessibility baseline (contrast, touch targets, ARIA, focus,
reduced motion, adjustable + system-following font scale); semantic versioning surfaced in-app; and
an Android home-screen widget showing the next prayer with a live countdown — all without touching
`server/src/prayer-engine/`, without letting the engine into the web bundle, and with every phase
gated by build/test commands.

## 2. Decisions already made — do NOT reopen

| # | Decision |
|---|---|
| D1 | **v2.0.0** semver now; `client/package.json` is the version source of truth; Android `versionName` = semver, `versionCode` monotonic **+1 per Play upload** (this release → 2). Server version independent. |
| D2 | Redesign applies **everywhere** — web (prayer.altijwal.com) and native are the same client; no native-only layout fork. |
| D3 | **4 bottom tabs**: الرئيسية (hero clock) · المواقيت (today list + month table) · التقارير (reports) · الإعدادات (settings). Search/location stays a Home header action. Tab labels are user-approved. |
| D4 | **Android Auto deferred**: Google Play only accepts media/navigation/POI/IoT/weather car categories (verified 2026-07-12; no utility/religious category). Instead ship an Android **home-screen widget**. Revisit Auto when Google opens widgets/new surfaces (announced direction, May-2026 Android blog). |
| D5 | **Theme gallery = distinct design languages, not recolors**: `night` الليل (current look, default) · `glass` (Apple iOS-26 Liquid Glass replica) · `material` (Google Material 3/Expressive) · `contrast` (high-contrast a11y). Adding a future theme must only require a new CSS block + registry entry. |
| D6 | **A11y package — all four**: WCAG contrast in every theme, ≥48px touch targets, ARIA labels, visible focus, `prefers-reduced-motion`; in-app font-size setting; high-contrast theme; follow Android system font scale. |
| D7 | Every new user-visible Arabic string requires the user's explicit approval **before** it ships (propose via the design preview; master list §6). Tab labels already approved. |
| D8 | **No new runtime dependencies**: no router (4 static tabs, `useState`), no chart library (hand-rolled SVG/CSS matching `ProgressRing`), no UI kit. |
| D9 | Tabs are **keep-mounted** (`hidden` attribute on inactive pages) — preserves the hero countdown interval state and the single `--breath` animation timeline. Activation transition is **opacity-only** (a transformed ancestor would trap the `CheckinControl` `position:fixed` portal — documented gotcha). |
| D10 | The `.breath-driver` root div in `App.tsx` remains the persistent ancestor of ALL breathing elements (hero halo, `.breath-glow` cards) — the tab switcher lives INSIDE it. |
| D11 | Hard rules inherited from `AGENTS.md` §Hard rules: engine verbatim + never in the web bundle (findstr gate), UTC times + location tz, zod at boundaries, `prayer.*` Traefik names, typecheck via `npm run build` only. |

## 3. Architecture & system changes

```
client/src/
  main.tsx ──────────────── + pre-paint theme boot (localStorage prayer.app.v1.theme → html[data-theme])
  App.tsx (SHELL only) ──── global hooks (usePrayerTimes, useWorshipLog, useLocation, useSettings,
                            usePushSubscription, useLocalAlerts, useNativeAlarmScheduler, useAlarm,
                            useWakeLock, useFirstRunPermissions, audio unlock, [useWidgetSync P9])
                            + .breath-driver root (D10) + tab useState + overlays (CitySearch,
                            4 worship sheets, AlarmOverlay) + tab-aware hardware back
  components/shell/TabBar.tsx     4 tabs, in-flow (not fixed), safe-area-bottom, role=tablist
  pages/HomePage.tsx              TopBar + hero + PrayerStrip (new) + NextEvent    (no-scroll)
  pages/TimesPage.tsx             today PrayerList (moved) + MonthNav + MonthTable (scrolls)
  pages/ReportsPage.tsx           worship reports (replaces StatsSheet)            (scrolls)
  pages/SettingsPage.tsx          ex-SettingsPanel sections + theme gallery + font size + About

  index.css ──── keeps the @theme block (night defaults → Tailwind utilities compile to var()
                 references) + imports the new two-layer theme CSS:
  styles/surfaces.css ──── the surface-recipe CONTRACT (~20 custom props with night defaults on
                 :root: --bg-scene, --surface-card-bg/-border/-blur/-specular, --radius-card/
                 -control, --elev-1/-2, --press-layer, --motion-press, --focus-ring,
                 --color-veil/--color-veil-strong …) + the shared chrome classes rewritten to
                 consume ONLY these (.card, .tab-bar, .sheet-surface, .pill, .pressable,
                 body background, :focus-visible)
  styles/themes/{glass,material,contrast}.css ──── one html[data-theme=X]{…} block each
                 (palette + recipe overrides + minimal theme-scoped rules). night = :root
                 defaults, needs no file. Adding theme #5 = one CSS file + one registry entry.
                 prefers-reduced-motion freezes breath/shimmer/float/spin; html font-size scales
                 via data-font-scale.

server/src/prayer/month-payload.ts ── ONE shared month module: pure buildMonthPayload() looping
                 computePrayerTimes + fmtTime + Hijri per day (no events/windows). Web: exposed as
                 GET /api/prayer-times/month. Native: imported VERBATIM by the native lazy chunk
                 through the existing reusedEngineResolver (exactly how local-times.ts reuses
                 payload.ts) — one implementation, both sides, engine still never in the web bundle.
client/src/native/widget-data.ts + hooks/useWidgetSync.ts ── 7-day compact table → plugin
client/android/…/prayer/widget/ (Java, Phase 9): WidgetStore (SharedPreferences, AlarmStore
                 pattern) · PrayerWidgetProvider · WidgetUpdater (RemoteViews + Chronometer
                 countdown, boundary re-render via setExactAndAllowWhileIdle) · WidgetBoundaryReceiver
```

**Storage:** `prayer.app.v1` gains `theme: "night"|"glass"|"material"|"contrast"` (default
`"night"`; unknown value → coerce to `"night"`) and `fontScale: 1|1.125|1.25` (default 1).
`prayer.worship.v1` unchanged — Reports read it through `deriveStats` (extended, Phase 6).

**System chrome:** status-bar icon style follows the active theme at runtime (Capacitor StatusBar
API; `capacitor.config.ts` keeps DARK as the boot default), PWA `<meta name="theme-color">` updated
on theme change. The native `AlarmActivity` stays dark regardless of theme (alarms are a dark
full-screen surface by design — note in FRONTEND.md).

## 4. Phases — each ends with gates that must pass

Global gates, run after EVERY phase (from `D:\dev\prayer`):

```powershell
npm --prefix client run build     # the ONLY valid client typecheck (tsc -b + native tsconfig + vite)
npm --prefix client test          # client vitest
npm --prefix server test          # server vitest
findstr /m astronomy client\dist\assets\*.js    # must list ONLY the native api-*.js lazy chunk
# native-touching phases additionally:
cd client; npx cap sync android; cd android; .\gradlew.bat assembleDebug
```

### Phase 0 — Spec + versioning foundation
1. Commit this file.
2. `client/package.json` → `"version": "2.0.0"`.
3. `client/vite.config.ts` → `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` (read
   package.json at config time); `client/src/vite-env.d.ts` → `declare const __APP_VERSION__: string;`.
4. `client/android/app/build.gradle` → `versionCode 2`, `versionName "2.0.0"`.
5. New `CHANGELOG.md` (Keep-a-Changelog): retro `## [1.0] - 2026-07` (Play closed-testing release),
   open `## [2.0.0] - unreleased` that accumulates entries as phases land.
6. `docs/PLAY_RELEASE.md` post-launch procedure: bump = package.json + build.gradle (+1 code) +
   CHANGELOG entry. `docs/DECISIONS.md` ADR-008 (semver policy, source of truth).
Commit: `chore: adopt semver v2.0.0 (versionCode 2) + spec + CHANGELOG`.

### Phase 1 — Theme engine core (zero visual change)
1. New `client/src/styles/surfaces.css` (the §3 contract, night defaults on `:root`) and rewrite
   `body` background, `.card`, `.arabesque`, `::selection`, shimmer, halo/glow color hooks to
   consume it. The glass specular hook is a `::before` on `.card`/`.tab-bar` that resolves to
   invisible outside the glass theme (no per-theme markup).
2. **Token sweep (the single largest mechanical task):** replace ~86 raw `white`/`black` alpha
   utility usages across ~30 component files (biggest: `AlertForm.tsx` ×10, `design-preview/shared.tsx`
   ×14, `RawatibSheet`/`AlertRuleList` ×4) and 13 component `rgba()` literals with semantic
   utilities (`bg-veil`, `bg-veil-strong`, scrim, `text-ink*`) — otherwise light-leaning themes
   (glass/material) break. Add `--color-veil`/`--color-veil-strong` to the `@theme` block.
   Night MUST render pixel-identically (Playwright screenshot diff gate before/after).
3. New `client/src/lib/theme.ts`: `THEMES` registry `{ id, nameKey, systemBarsLight, themeColor }`,
   `applyTheme(id)` (sets `data-theme`, theme-color meta, native appearance bridge), `coerceTheme`.
4. `lib/storage.ts` + `hooks/useSettings.ts`: `theme` + `fontScale` fields, `setTheme`,
   `setFontScale` (persisted via existing `patchState`; migrate() coerces unknown → night).
5. Pre-paint boot: inline snippet in `client/index.html` reading `prayer.app.v1` and stamping
   `data-theme` + `data-font-scale` on `<html>` before first paint (no flash).
6. Reduced motion: `@media (prefers-reduced-motion: reduce)` freezes `.breath-driver`, shimmer,
   float, spin-slow, iqama-blink (opacity states pinned to their calm values).
7. Dev preview hooks: support `?theme=X` and a `T` key that cycles `data-theme` live (dev only,
   in `DesignPreview`/`main.tsx`) — this is the theme approval loop's steering wheel.
8. **Native appearance bridge:** new plugin method `PrayerAlarm.setAppearance({ systemBarsLight,
   bg })` — toggles `WindowInsetsControllerCompat.setAppearanceLight*Bars` at runtime
   (capacitor.config.ts keeps DARK as the pre-JS boot default) and paints the window decor
   background with the theme color. **Alarm screens follow the theme too (user decision
   2026-07-12):** the web `AlarmOverlay` is token-driven (auto-themed; previewed at `?design=11`);
   in Phase 7 `setAppearance` grows a small palette payload `{bg, ink, inkDim, accent}` persisted
   to an `AppearanceStore.java` (SharedPreferences) that `AlarmActivity` reads for its programmatic
   UI (falls back to night when unset). Only the pre-WebView splash stays night.
Gate extra: screenshot diff (Playwright) — pixel-identical night; emulator system-bar flip check.
Commit: `feat(client): runtime theme engine (night tokens, no visual change)`.

### Phase 2 — Design previews (approval gate — blocks 3–7)
1. `?design=9`: v2 tab-shell mock (`design-preview/v2-shell.tsx`) — working in-mock TabBar, all four
   tabs with mock data (Home hero+strip, Times today+month table, Reports full card set, Settings
   incl. theme gallery + About).
2. `?design=10`: theme gallery mock — the same mock screens rendered under `glass` / `material` /
   `contrast` candidate CSS (switchable in-mock).
3. Iterate live with the user (both dev servers + Playwright screenshots at 390×844 AND 360×740).
4. Collect explicit approvals: tab layout, Home strip vs list, per-theme look, and EVERY §6 string.
Commit: `feat(preview): v2 shell + theme gallery design screens`.

### Phase 3 — App shell + tabs (structure only, JSX moved verbatim)
1. New `components/shell/TabBar.tsx` (lucide `House`, `CalendarClock`, `ChartColumn`, `Settings2`;
   active accent; `role="tablist"`/`tab`/`aria-selected`; `padding-bottom: var(--safe-area-inset-bottom, 0px)`).
2. New `pages/*.tsx` per §3 — move JSX out of `App.tsx`/`SettingsPanel.tsx` WITHOUT visual changes.
   `SettingsPage` = the three `CollapsibleSection`s + About row (`__APP_VERSION__`). Delete
   `SettingsPanel.tsx`, drop `settingsOpen` + the TopBar gear (freed start column keeps the clock).
3. App root: `min-h-screen` → `h-dvh overflow-hidden`; children = pages wrapper (`flex-1 min-h-0`)
   + TabBar. Pages keep-mounted via `hidden`; activation = ~150ms opacity fade class. Body bottom
   safe-area padding moves INTO TabBar (no double count).
4. Back chain in App's `useAndroidBack` handler: alarm → worship sheet → search → `tab !== "home"`
   → `setTab("home")` → false (minimize). ScorePill `onOpen` → `setTab("reports")` (StatsSheet
   still renders until Phase 6 replaces it).
5. Z-order: TabBar `z-40`; sheets/slide-overs (z-50) cover it; AlarmOverlay `z-[100]`.
Gate extra: emulator back-chain pass; countdown keeps ticking + breath phase-continuous across tab
switches. Commit: `feat(client): 4-tab app shell (home/times/reports/settings)`.

### Phase 4 — Home re-tune + PrayerStrip
1. New `components/PrayerStrip.tsx`: 6-col grid (name over time, `tnum`), next prayer = proximity
   accent + `.breath-glow`, passed dimmed, Friday label swap via `isFriday`.
2. `PrayerList` (2-col cards + `CheckinControl`) moves to TimesPage. Hero check-in row remains the
   Home check-in surface.
3. Re-tune hero constants for the TabBar budget (ring size, `SatelliteRing`/`CornerRing` pins,
   `IqamaBar` widths) — tune in preview, land in components.
Gate extra: Playwright no-scroll assertion (`document.documentElement.scrollHeight <= innerHeight`)
at 390×844 + 360×740 × (all features on / all off / iqama-bar visible / check-in visible).
Commit: `feat(client): home hero + prayer strip re-tune for tab layout`.

### Phase 5 — المواقيت Times tab
1. **Shared module**: new `server/src/prayer/month-payload.ts` — pure
   `buildMonthPayload({lat,lon,tz,method,asr,elevation,lang,month})` looping `computePrayerTimes`
   + `fmtTime` + Hijri per civil day (engine untouched, no events/windows); rows display-only:
   `{ date, hijriDay, hijriMonth, hijriYear, isFriday, times: { fajr…isha: string } }` + envelope.
2. **Server route**: zod `MonthQuery` (reuse per-param schemas; `month` regex `^\d{4}-\d{2}$`),
   `GET /api/prayer-times/month` in `prayer/routes.ts`. Tests `month.test.ts`: Baghdad snapshot
   incl. a Waqf exact-data date, calibration parity with the daily endpoint, tz anchoring,
   high-latitude nulls, invalid month → 400. Update `docs/PRAYER_TIMES_API.md`.
3. **Native**: the native lazy chunk imports `month-payload.ts` VERBATIM through the existing
   `reusedEngineResolver` (same mechanism as `local-times.ts` → `payload.ts`) — no second
   implementation. Export `computeLocalMonth` via `native/api.ts` + widen `NativeFacade` in
   `lib/native.ts`. Parity test in the native test suite.
4. **Client**: `hooks/useMonthTimes.ts` — lazy on first Times visit (visited flag; pages are
   keep-mounted), in-memory `Map` cache keyed `(lat,lon,tz,month)`, web `fetchMonthTimes` in
   `lib/api.ts`, native via facade. `components/times/MonthTable.tsx` (Gregorian day + Hijri day
   columns, 6 time cols, today row gold, Friday rows tinted, Latin numerals, sticky header; at
   360px width either compress type or drop the sunrise column — preview decision) + `MonthNav.tsx`
   (chevrons + month title + reset-to-current).
Gate extra: emulator airplane-mode month render; single network request per month on web.
Commits: `feat(server): monthly prayer-times endpoint` · `feat(client): times tab (today list + month table)`.

### Phase 6 — التقارير Reports tab
1. `lib/worship-stats.ts` (+`worship-stats.test.ts`): add `heatmap62: DayScore[]` (zero-filled,
   oldest→newest, length = `RETAIN_DAYS` import); `perPrayer62: Record<FardPrayer, {masjid,home,missed}>`
   (retained days only); extend `MonthScore` with `perfectDays`, `masjid`, `home`, `missed`,
   `bestDayScore` (fields already exist in folds + `dayContribution`).
2. New `components/reports/`: `TodayCard.tsx` (StatsSheet top-half: ring /29 + 4 category bars +
   streak flames), `TrendChart.tsx` (extracted Bar + أسبوع/شهر/أشهر switcher), `HeatmapCalendar.tsx`
   (weeks×7 grid, score color scale, today outlined), `PerPrayerBreakdown.tsx` (5 stacked
   masjid/home/missed bars, `MosqueIcon` gold/teal/red), `LifetimeTotals.tsx` (totals, perfect days,
   best day + date when retained).
3. `pages/ReportsPage.tsx`: gating — `features.record` off → CTA empty state whose button calls
   `setFeature("record", true)`; category rows omitted (not zeroed) when their flag is off; sunan
   row only when `duha || qiyam` enabled.
4. Delete `StatsSheet.tsx`; remove `"stats"` from the `WorshipSheet` union.
Gate extra: new vitest cases green (heatmap fill/order, perPrayer counts, enriched monthly
straddling the 62-day horizon); seeded-log visual pass.
Commit: `feat(client): reports tab (heatmap, per-prayer, trends, lifetime)`.

### Phase 7 — Themes build-out + gallery UI
Implement three `html[data-theme=X]` blocks on the finished components (per-theme specs §5):
`glass`, `material`, `contrast`. Then Settings gallery UI (swatch cards showing a mini preview of
each theme; selecting applies instantly via `applyTheme`). Also: **native alarm-screen theming** —
extend `setAppearance` with `{bg, ink, inkDim, accent}` → new `AppearanceStore.java`
(SharedPreferences, AlarmStore pattern) → `AlarmActivity` builds its programmatic UI from the
stored palette (night fallback); verify on the emulator with a non-night theme active and the app
killed before the alarm fires.
Gate extra: axe/Playwright contrast scan per theme; glass theme 60fps scroll/tab-switch on emulator
+ one real device (if it stutters: reduce blur radius/layer count before shipping); screenshots of
every tab × every theme × both viewports.
Commit: `feat(client): theme gallery (glass, material, high-contrast)`.

### Phase 8 — Accessibility package
1. ARIA sweep: TabBar = `<nav>` + `aria-current="page"` (simpler + more robust in RTL than
   tablist), toggles (`role="switch"` — verify), steppers, sheets (`role="dialog" aria-modal` +
   labels), check-in trio, corner rings, month nav. **Ticking countdown texts get
   `aria-hidden="true"` with a stable `aria-label` on the container** — prevents screen-reader
   spam every second. Decorative `ProgressRing`s → `aria-hidden`.
2. `:focus-visible` rings on every interactive element (token-driven so contrast theme can thicken).
3. Touch targets ≥48px: audit `CheckinControl` trio, `ScorePill`, corner rings, stepper buttons,
   `MonthNav` chevrons (pad hit areas, not visuals).
4. Font-size setting عادي/كبير/أكبر → `--font-scale` 1/1.125/1.25 on `<html>` (`font-size:
   calc(16px * var(--font-scale))`); re-tune Home tolerance at 1.25.
5. Native system font scale: verify the WebView honors Android font scale (Capacitor does not pin
   `textZoom` by default — if it does, set `WebSettings.textZoom` from `Configuration.fontScale` in
   `MainActivity`); cap combined scale tolerance ~130%.
Gate extra: axe scan clean per theme; TalkBack smoke on emulator; Playwright runs at fontScale 1.25
+ reduced-motion emulation.
Commit: `feat(client): accessibility package (a11y baseline + font scaling)`.

### Phase 9 — Home-screen widget (droppable to v2.1)
1. JS: `native/widget-data.ts` (7-day compact `{dayKey, prayers:[{name, labelAr, at}]}` via the
   existing per-day compute) exported through the facade; `hooks/useWidgetSync.ts` (same triggers as
   `useNativeAlarmScheduler`) → new plugin method `PrayerAlarm.updateWidget({days, city})`;
   `lib/native.ts` plugin type widened.
2. Java `com.altijwal.prayer.widget`: `WidgetStore` (SharedPreferences `prayer_widget_store`),
   `PrayerWidgetProvider` (AppWidgetProvider), `WidgetUpdater` (next upcoming prayer from store →
   RemoteViews: AR name + clock time + `setChronometerCountDown(true)` live countdown, Latin digits;
   arms ONE `setExactAndAllowWhileIdle` at the boundary to re-render; tap → MainActivity),
   `WidgetBoundaryReceiver`. `PrayerAlarmPlugin.updateWidget` writes store + renders;
   `BootReceiver` also refreshes the widget.
3. Manifest: widget receiver + `APPWIDGET_UPDATE` filter + `widget_prayer_info.xml` meta-data
   (fallback `updatePeriodMillis` ≈ 30 min), boundary receiver. Resources: `res/layout/widget_prayer.xml`,
   info xml, description string, preview.
4. Stale state (7-day store exhausted): CTA text (§6) instead of wrong times.
5. Known risks: RemoteViews can't load the Cairo font (system font renders Arabic fine); if the
   Chronometer renders Eastern-Arabic digits (violating the Latin-digits rule), fall back to
   minute-tick text updates driven by the boundary alarms — decide on the emulator; no new Play
   permission declarations.
Gate extra: emulator — add widget, boundary rollover (incl. post-Isha → tomorrow-Fajr), reboot,
uninstall/reinstall, tap-to-open; `assembleDebug` green.
Commit: `feat(android): next-prayer home-screen widget`.

### Security gates (cross-cutting — user-mandated)
- Every server-touching phase (esp. Phase 5): zod at the boundary, no error-detail leaks, and an
  abuse note — `/api/prayer-times/month` computes ~30 engine days per hit; it sits behind the same
  public-API posture as `/api/prayer-times` (Cloudflare in front; add an express rate limit for the
  month route if load testing shows it matters).
- Native bridge inputs are untrusted JS: `setAppearance` guards `Color.parseColor` (try/catch,
  ignore malformed); widget store JSON is parsed defensively like `AlarmStore`.
- No secrets in the repo (CLAUDE.md/OPERATIONS.md stay gitignored; keystore stays in D:\keys);
  worship/report data never leaves the device (client-only localStorage).
- **Before the Phase-10 upload: run a security-review pass over the v2 diff** (security-reviewer
  agent) and fix CRITICAL/HIGH findings.

### Phase 10 — Docs sweep + release
1. `docs/FRONTEND.md`: new §App shell & tabs + §Theme engine; rewrite §5/§7/§8/§9 references
   (SettingsPanel→SettingsPage, StatsSheet→ReportsPage, PrayerStrip, layout budget, AlarmActivity
   stays dark). `docs/PRAYER_TIMES_API.md` month endpoint (if not landed in P5).
   `docs/DECISIONS.md`: ADR-008 semver · ADR-009 4-tab redesign (no router, keep-mounted) ·
   ADR-010 theme-gallery architecture · ADR-011 Android Auto deferred (category policy) → widget.
   `docs/ARCHITECTURE.md` client tree. Finalize CHANGELOG 2.0.0.
2. Release: `npm run build; npx cap sync android; cd android; .\gradlew.bat bundleRelease` →
   upload `app-release.aab` (versionCode 2) to the EXISTING closed track (does not reset the
   12-tester/14-day clock) with the approved AR release notes.

## 5. Theme design specs (implement in Phase 7; preview in Phase 2)

Common architecture: components style ONLY through semantic tokens + shared surface classes
(`.card`, `.pill`, TabBar classes). A theme = one `html[data-theme=X]{…}` block overriding tokens
and (where needed) the surface recipes. No per-theme React forks unless flagged during Phase 2.

- **night (default)** — exactly the current look (Phase 1 froze it into tokens); minor polish only
  with user approval.
- **glass (Liquid Glass, Apple iOS 26)** — translucent layered surfaces over a light-leaning
  colorful gradient-blob background scene (glass needs content behind it to read):
  `backdrop-filter: blur(20–28px) saturate(170–180%)`; fills `rgba(255,255,255,0.10–0.16)`
  (adaptive darker variant for text-heavy cards); multi-layer shadows = inset 1px top specular
  highlight (`rgba(255,255,255,0.55)`), hairline rim border, soft wide outer drop shadow;
  **floating detached pill TabBar** (inset from edges, not edge-pinned); concentric corner radii
  (child = parent − inset); optional refraction on hero ring chrome + TabBar via SVG
  `feDisplacementMap` used as `backdrop-filter: url(#…)` — Chromium-only, which covers Android
  WebView + Chrome; wrap in `@supports` with the plain-blur fallback. Perf: `contain: layout paint`,
  `will-change: transform` on glass nodes, keep filtered areas small.
- **material (Google Material 3 / Expressive)** — fully opaque **tonal** surfaces derived from the
  brand teal/emerald/gold as an M3-style tonal palette; elevation via tone shift + subtle shadow
  (no blur/transparency anywhere); TabBar = M3 navigation bar with a **pill active indicator**
  behind the icon; radius scale 12–28px (cards ~16, sheets 28 top); press feedback = state layers
  (8%/12% on-color overlays); springier/snappier transition curves; bolder type ramp for titles.
- **contrast (high-contrast a11y)** — solid near-black surfaces, **zero transparency/blur**, 2px
  solid borders, AAA-leaning text contrast (≥7:1 body), thick 3px focus rings, proximity palette
  swapped for a colorblind-safer high-contrast set, no decorative glows (breath halo disabled).

## 6. Strings — NEEDS-USER-APPROVAL master list (confirm during Phase 2)

| Area | Key (proposed) | Proposed AR |
|---|---|---|
| Theme names | `theme.night/glass/material/contrast` | «الليل» · «الزجاج» · «ماتيريال» · «تباين عالٍ» |
| Settings | `settings.theme` | «المظهر» |
| Font size | `settings.fontSize` + `fontSize.normal/large/xlarge` | «حجم الخط» · «عادي/كبير/أكبر» |
| About | `settings.version` | «الإصدار» |
| Times tab | `times.todayTitle/monthTitle/thisMonth/hijriCol/dayCol` (+aria prev/next) | «مواقيت اليوم» «الجدول الشهري» «هذا الشهر» «هجري» «اليوم» |
| Reports | `reports.heatmapTitle/perPrayerTitle/lifetime/perfectDays/emptyTitle/emptyBody/enableRecord` | «آخر 62 يومًا» «سجل الصلوات (آخر 62 يومًا)» «الإجمالي الكلي» «أيام كاملة» «السجل غير مفعّل» «فعّل ميزة السجل لتتبّع صلواتك ونقاطك اليومية» «تفعيل السجل» |
| Widget | description + stale CTA | «الصلاة القادمة مع عدّاد تنازلي» · «افتح التطبيق لتحديث المواقيت» |
| Release | Play closed-track release notes (AR) | drafted in Phase 10 |

Every key mirrors into `strings.en.ts` (the `StringKey` source of truth) even while the UI is
Arabic-locked.

## 7. Acceptance criteria (final, observable)

1. App opens on Home; 4 tabs with approved labels; switching tabs never resets the hero countdown
   and the breath animation stays phase-continuous; Home fits 390×844 AND 360×740 with zero
   vertical scroll in every feature/iqama state; Times/Reports/Settings scroll internally; web and
   native look identical.
2. Hardware back (emulator): alarm overlay → worship sheet → search → non-home tab (lands Home) →
   minimize. `?alarm=` deep link still lands on Home with the overlay.
3. Times: today list with working check-ins; month table (today gold, Fridays tinted, Hijri column,
   Latin digits) with month nav; native renders any month in airplane mode; web = one request per
   month, cached in-session.
4. Reports: `record` ON + seeded data → today ring /29, 4 streaks, trend switcher, 62-day heatmap,
   per-prayer stacked bars, lifetime totals; `record` OFF → only the CTA; disabled categories
   absent, not zeroed. ScorePill navigates to the tab; StatsSheet gone.
5. Themes: gallery in Settings; selecting any of الليل/الزجاج/ماتيريال/تباين عالٍ re-skins the whole
   app instantly and persists across restarts with no wrong-theme flash; glass shows real
   translucency + specular edges + floating tab bar; material shows opaque tonal surfaces + pill
   indicator (structurally different, not recolored); native status-bar style follows the theme;
   About shows `2.0.0`.
6. A11y: axe contrast scan passes per theme; interactive elements ≥48px + labeled (TalkBack smoke);
   `prefers-reduced-motion` stops breath/shimmer/float; أكبر font size keeps Home unclipped;
   Android system font scale is reflected.
7. Widget: next prayer + live countdown; boundary rollover (incl. Isha→Fajr); survives reboot;
   tap opens the app; stale CTA after the 7-day store empties.
8. Play: AAB versionCode 2 uploads to the existing closed track.

Commands for every gate: §4 header block.
