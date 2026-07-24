# Frontend

React 19 + Vite 7 + Tailwind 4 SPA. GPS-driven, bilingual (AR default, RTL-aware), live countdown,
installable PWA (required for iOS push). Design reference — no code yet.

Related: `ARCHITECTURE.md` (request/tz model), `DECISIONS.md` ADR-004 (localization), `GEOCODING.md`,
`NOTIFICATIONS.md`.

---

## 1. Location flow (`useLocation` + `lib/geolocation.ts`)

Resolution — never blocks the UI:
1. Persisted location in `localStorage` → render instantly. (Locations saved before Arabic names
   existed are upgraded once via a reverse lookup to backfill `cityAr`.)
2. Else **default to Baghdad** (`33.3152, 44.3661`, `Asia/Baghdad`) — the app opens on Baghdad with
   **no auto-GPS prompt** (Iraq-centric audience; changed 2026-06-19).
3. GPS is **opt-in**: the search panel's "Use my location" button →
   `lib/geolocation.ts getCurrentPosition` → `GET /api/geo/reverse`
   → `{ city, cityAr, country, tz, elevation, method }` → persist.
   `getCurrentPosition` branches per platform (2026-07-19): web wraps
   `navigator.geolocation`; **native (Capacitor) uses `@capacitor/geolocation`**
   (dynamic import — its chunk never loads on web), because the WebView's
   `navigator.geolocation` has no runtime permission and every fix fails. The
   plugin requests `location`/`coarseLocation` once (the OS remembers) and its
   errors map onto the same `GeolocationFailure` kinds, so callers don't branch.
4. Or pick via `CitySearch` (forward `/api/geo/search`) / the `GovernorateList` quick-pick.

The resolved `{ lat, lon, tz }` feed `GET /api/prayer-times`; `method`/`asr` are auto-resolved
server-side from the country and not chosen in the UI.

---

## 2. Live countdown (`usePrayerTimes`)

Generalizes home's hook. Fetch the payload (absolute `timestamp`s) once per civil day / on change;
tick a local `setInterval(1000)` recomputing each `countdown` from `timestamp − Date.now()` and
re-deriving `isNext`/`isPassed` client-side, so the timer is smooth and never diverges from the
server. **Re-fetch** on: location/method change, local-midnight rollover, tab refocus after staleness.

**Proximity palette (as-built — `lib/format.ts` + `components/ui/proximity.ts`):** thresholds are
`safe` (>15 min) → `warning` (≤15) → `urgent` (≤10) → `critical` (≤5) → `imminent` (≤1), colours
**green → yellow → orange → red → pulsing red**, resetting to green when the next prayer's countdown
begins.

**One synchronized breath (shared `--breath` driver):** every breathing element pulses off a **single**
animated custom property so they all peak together — no phase drift even when the "next prayer" rolls
over. `App.tsx` puts the `.breath-driver` class + an inline `--glow-period` on the page wrapper (a
common ancestor of the hero and the list); that one element runs `@keyframes breath-cycle` which animates
the **registered** `@property --breath` (0=trough→1=peak, `ease-in-out`). Two elements *read* the
inherited `--breath` via `calc()`:
- the **hero halo** (soft radial `<div>` behind the ring, `background` = proximity accent) — `scale`
  0.63→0.975 (~40%→95% area) + `opacity` 0.22→0.32 (floored, never fully fades);
- the **next-prayer card** (`.breath-glow`) — a `box-shadow` whose spread breathes, tinted by the
  proximity accent via `--prox` (`color-mix`). Only the `isNext` card glows; the rest stay calm.

Speed **ramps with the countdown** via `--glow-period`: `glowBreathPeriod(ms)` (`lib/format.ts`) maps
remaining minutes to ~14s (far, calm) → 1s (last minute), **bucketed to whole minutes** so it re-times
once per minute, not every tick (no jitter). The ramp is **geometric (≈0.83×/min)**, not linear:
perceived speed is *frequency* (1/period), so a linear period ramp barely changes the felt speed near
the top (14s→13s is invisible) and only collapses in the final minutes (Weber's law). Sample:
15min→14s, 14→11.6s, 13→9.6s, 10→5.5s, 5→2.1s, 1→1s.

**The countdown text does NOT breathe** (removed the old `soft-pulse` — by request it only fired in the
last minute and read as out-of-sync). **No card-edge/border glow on the hero** — the section keeps only
the `rise-in` entrance + the static `.card` depth shadow. **Gotcha** `[[hero_glow_animation_gotcha]]`:
never stack two `animate-*` utilities on one element — both set the `animation` shorthand and the later
one silently wins. With the shared-`--breath` model the halo/card carry **no** `animation` of their own
(only computed `transform`/`opacity`/`box-shadow`), so nothing clashes with `rise-in`. Colour vars live
in `index.css`.

**Countdown text:** both the hero "remaining circle" and the prayer rows use the same
`formatCountdown` format — spaced unit labels joined by a colon, seconds dropped once an hour remains.
Every value is **zero-padded to 2 digits** so the tabular figures never shift width as they tick:
`02 س:05 د` past an hour, `59 د:19 ث` under it, `05 ث` in the last minute (Arabic units shown; `h/m/s`
in English). Latin digits. **Every upcoming prayer row shows its own remaining countdown** (not just the
next one) — the next prayer carries the proximity accent, the rest stay calm (`text-ink-dim`), passed
rows dim with no countdown.

---

## 3. i18n + RTL (`i18n/I18nProvider`)

- Two flat dictionaries (`strings.ar.ts`, `strings.en.ts`) + a `t(key)` lookup. **No heavy i18n
  library** — keeps the bundle small (tech-assessment: fix patterns, don't add weight).
- **Arabic default.** On language change set `document.documentElement.lang` and `dir`
  (`rtl` for ar, `ltr` for en).
- Tailwind **logical properties** (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`) for RTL-safe layout —
  avoid hard `left`/`right`. (Watch decorative absolute positioning: the hero glow had to use
  **physical `left-1/2`** — logical `start-1/2` + `-translate-x-1/2` drifts off-centre in RTL.)
- **Numerals are ALWAYS Latin** (product decision "keep numbers in English"), even in Arabic.
  `lib/format.ts` `localizeDigits` is a deliberate **no-op pass-through**; the server uses the
  `-nu-latn` locale extension (`fmtTime` → `ar-u-nu-latn`, `hijriDate` → `…-nu-latn`) so Arabic text
  carries Latin digits. `TopBar`'s live time uses `ar-u-nu-latn`; its **Gregorian line uses the
  Levantine/Iraqi month names** (`lib/gregorian.ts` — حزيران not يونيو, Latin numerals, month
  resolved in the target tz). The **next-event date renders in the Hijri calendar** (`lib/hijri.ts`,
  Umm al-Qura, mirroring the server's `hijriDate`).
- **Prayer names are translated client-side** via the existing `prayer.*` keys (`t(`prayer.${name}`)`
  in `NextPrayerCountdown` + `PrayerCard`) — the server `LABELS` are English-only and were showing raw
  in Arabic mode.
- **Place names:** `lib/locale.ts` — `localizeCountry` (via `Intl.DisplayNames`) and
  `cityDisplayName`/`storedCityName` (the dataset's Arabic `nameAr`/`cityAr` in Arabic mode, Latin
  fallback). See `GEOCODING.md`.
- **Fonts:** Arabic is **Cairo** (`--font-arabic` in `index.css`, Google Fonts in `index.html`) —
  switched from Tajawal.
- **Arabic line-height (clipping caveat):** Arabic glyphs (Cairo) have descenders that a tight line
  box crops — **never pair `leading-none` with `truncate`** (`truncate` sets `overflow:hidden`, so the
  glyph bottoms get clipped) on Arabic text. Use `leading-snug`+. The prayer-card titles hit this when
  bumped to `text-base` (clipped at the bottom) and were fixed to `leading-snug` (2026-06-20).
- **UI is LOCKED to Arabic.** `main.tsx` hardcodes `<I18nProvider initialLang="ar">`, ignoring any
  stored preference and the browser language — there is **no language picker** in the UI. The English
  dictionary + the `setLang`/`toggleLang`/`LanguageToggle` machinery are **retained in code** for
  future re-enablement (restore the stored-`language` lookup in `main.tsx` + the picker in
  `SettingsPanel`). The `language` storage key still exists but is never written.

---

## 4. localStorage (`lib/storage.ts`, versioned)

Wrap in a versioned envelope `{ v: 1, ... }` for safe migrations. Keys:

| Key | Shape |
|---|---|
| `location` | `{ city, cityAr?, country, tz, lat, lon, elevation }` |
| `language` | `"ar"` \| `"en"` |
| `iqamaMinutes` | `{ fajr, dhuhr, asr, maghrib, isha }` — minutes from adhan to iqama (defaults 25/15/15/5/10; `migrate()` coerces each key to a finite 0–60, defaulting when absent — no version bump). **No `sunrise`** (no iqama). |
| `features` | `{ duha, qiyam, rawatib, adhkar, record }` — **opt-in worship features, all `false` by default** (§5/§8). `migrate()`/`coerceFeatures` treats each key as `false` unless a real `true` (missing → off), so a fresh or legacy user gets a clean core-only screen. Set via `useSettings().setFeature`. |
| `alarmSound` | selected alarm-tone id (`lib/alarm-sounds` catalog; default `soft-plucks`). The global tone every `alarm`-kind reminder plays. `migrate()` coerces unknown ids to the default. Set via `useSettings().setAlarmSound`. |
| `theme` | active design-language theme id (`night`/`glass`/`material`/`contrast`, default `night` — v2 Phase 7). `migrate()`/`coerceTheme` coerce unknown → `night`; `index.html` stamps it pre-paint. A legacy `fontScale` field is **silently dropped** by `migrate()` (the in-app font-size control was removed 2026-07-19 — ADR-012). |

Method/asr are **not** persisted from a picker any more (auto-resolved server-side; no UI). Reminder
selections are **server-side** (alert rules) — no `reminderPrefs` key. Note `features` (the worship
opt-ins) lives in `prayer.app.v1`; the tracker's *log/history* is a separate envelope
(`prayer.worship.v1`, §8) — toggling a feature off only hides its UI and never touches that log.

---

## 5. Components & hooks

**Hooks:** `usePrayerTimes` (also refetches when a Sunnah window's `end` lapses, to load the next one),
`useLocation`, `useSettings` (method/asr + `iqamaMinutes`/`setIqama`), `usePushSubscription` (lifecycle + exposes
the `endpoint`), `usePrayerAlerts(endpoint)` (the reminder rules — `NOTIFICATIONS.md`), `useWakeLock`
(holds a Screen Wake Lock so the phone screen doesn't sleep while the app is open; feature-detected,
re-acquires on `visibilitychange` since browsers drop the lock when the tab hides; silent no-op where
unsupported — no UI, called once in `App`).

**Components:**
- `TopBar` — single consolidated header row, a **3-column grid** (`grid-cols-[1fr_auto_1fr]`) so the
  **location is truly centred** regardless of the side widths: **[settings][live local time, no icon]**
  at the start, the centred location (Arabic name in Arabic mode; opens search — **city only, no
  country sub-line** as of 2026-06-24), and **both dates**
  (Hijri + **Levantine** Gregorian, centred stacked column) at the end. Time + dates are sized up to fill the row height the
  2-line location sets (no taller row). The centred location is visibly tappable — a trailing
  `ChevronDown` + a hover pill signal "change location". Replaced the old `LocationBar` + `NowCard`.
- `PrayerList` / `PrayerCard` — the six times as a compact **2-column grid** (3 rows). Each box is a
  **single vertically-centred row** with **generous vertical padding** (`py-5`, breathing room):
  `[name]` at the start (per-prayer icon removed; name is `text-lg` with `leading-snug` — tight
  `leading-none` clipped Arabic descenders under `truncate`, see §3),
  `[clock time / remaining]` as a centred stacked column at the end. The
  countdown shows for **every upcoming** prayer (next = proximity accent + glow/border, others calm,
  passed dim).
- `shell/TabPager` (v2.1, 2026-07-19) — the four keep-mounted pages live side-by-side in a translated
  track; a horizontal drag follows the finger and commits on distance/flick (pure math in `lib/swipe.ts`
  + tests). RTL-correct (`dirSign=+1`: RTL flex lays columns at negative x), `touch-action: pan-y
  pinch-zoom`, `[data-no-swipe]`/scrollable-child guard, off-screen pages `inert`+`aria-hidden`,
  pointercancel aborts (never commits), disabled while any overlay is open. `TabBar` exports `TAB_IDS`
  as the index order. **Gotchas (all real-Pixel-debugged):** the guard's walk STOPS at the pager's
  own page column (`data-pager-page`, also `overflow-x-hidden`) — `overflow-y-auto` coerces
  computed overflow-x to "auto", and under system textZoom a few px of horizontal overflow
  otherwise blocks every drag. **`touch-action: pan-y` must be ON the page scroll column** (the
  element the finger lands on — `touch-pan-y` in its classes): with it only on the viewport, the
  Android WebView cancelled every horizontal drag ~15px in (pointercancel) and swipes could never
  commit; MainActivity additionally sets `setOverScrollMode(OVER_SCROLL_NEVER)` on the WebView.
- `NextPrayerCountdown` — live timer to the next prayer inside a depleting ring (**184px** as of
  v2.1 — was 172 in the v2 shell, 208/192 in v1; name `text-2xl`, countdown `text-[1.85rem]`, the
  clock time kept at `text-base`): a single header line
  (`next.header` "الوقت المتبقي للاذان القادم", or `next.now` at adhan) + name + countdown + clock
  time. The three inner lines are **distributed vertically** (height-constrained `justify-between`) so
  they breathe without touching the ring. RTL-safe centred glow. The ring depletes across
  `[previous prayer → next prayer]` via `intervalProgress(intervalStart, target, now)`; `intervalStart`
  is the previous prayer's ts. **For Fajr (the day's first prayer)** there is no same-day predecessor,
  so the hook anchors `intervalStart` to **`data.yesterdayIsha`** (Isha→Fajr across midnight) — without
  it the ring sat **full and frozen** in the pre-Fajr window (`intervalProgress` returns 0 → `1 − 0`).
  `null` still falls back to the old soft-fill at extreme latitudes where Isha is undefined.
  It also hosts the three **secondary worship-time aids** (view-models derived per tick by pure
  `lib/hero-extras.ts` from the same `now`): two corner **`SatelliteRing`s** + the **`IqamaBar`** below
  the ring.
- `SatelliteRing` — a mini ring (reuses `ProgressRing`, **58px / stroke 5 / `size-5` icon**) pinned
  beside the **upper part** of the main ring: **Duha (الضحى) top-right** (amber `--color-amber`,
  `SunMedium`), **Qiyam (قيام, last third of the night) top-left** (indigo `--color-indigo`,
  `MoonStar`). Pinned with **physical** `top-6 right-1`/`left-1` so they **don't flip** under RTL
  (verified AR + EN) and the (wider) timer caption **clears the ring's curve** (~9px); `gap-1.5`
  between the ring and its title/timer. Active (`start ≤ now < end`) → coloured depleting arc +
  `satellite-glow` + countdown to the window **end**; inactive → dimmed (`opacity-50 grayscale`) but
  readable, counting down to the **next** window's start. The timer uses the **same `formatCountdown`
  format as the hero/list** (h/m/s units, zero-padded), tinted with the satellite's own colour.
  Windows come from API `duhaWindow`/`qiyamWindow` (`PRAYER_TIMES_API.md`); `usePrayerTimes` refetches
  the instant a window's `end` lapses so the next one loads without waiting for civil-midnight. Hidden
  when its window is `null` (high latitude) **or when its feature toggle is off** — each satellite is
  **opt-in** (`features.duha`/`features.qiyam`, off by default; the whole pinned overlay is skipped
  when both are off).
- `IqamaBar` — a horizontal bar below the ring, visible **only** between a prayer's adhan and its
  iqama (`deriveIqama` over `prayers[]` × the stored `iqamaMinutes`; **sunrise excluded**). Sizable
  (`h-2.5` track, `text-[13px]` row, `size-4` icon, `max-w-[320px]`, `mt-2`). **Depletes** adhan→iqama
  (width = fraction remaining); its colour tracks **time-to-iqama on the absolute proximity palette**
  (`proximityFromMs`, 15/10/5/1 min — the same thresholds as the hero ring), so **Maghrib (5 min) is
  red throughout, Isha (10 min) orange→red, Dhuhr/Asr (15 min) yellow→orange→red, Fajr (25 min)
  green→yellow→orange→red**. Fill is a same-hue `color-mix` gradient of the proximity colour; the
  caption + icon take the matching `text-*`. **Blinks (`.iqama-blink`) in the final 60 s**, then
  unmounts at iqama. A 0-minute setting never shows a bar. (Considered & rejected: progress-relative
  colouring — the user wants absolute "within 5 min = red" semantics, so a short window stays red.)
- `NextEvent` — next Islamic event (bottom card; only when an event exists), a **3-column grid** so the
  event name is **truly centred**: the label (`event.next`) at the start (**no icon**) · event name
  centred · the event **date over the days-left chip** (centred stacked column) at the end. The date is
  the **Hijri (Umm al-Qura)** date of `now + daysLeft` in the location tz (`lib/hijri.ts`), matching the
  header's Hijri line.
- `CitySearch` — debounced forward search (`/api/geo/search`); a **"Use my location" (GPS)** button +
  the **governorate list** as its default when the query is empty.
- `GovernorateList` — list of the country's governorate capitals (`/api/geo/governorates`), shown
  **in `CitySearch` only**; selecting one sets the location. **This replaced the manual method/Asr controls.**
- `SettingsPanel` — three **collapsible sections** (`ui/CollapsibleSection`), **all collapsed by
  default** (2026-07-11) so the panel opens as a compact list of headers: worship features
  (`WorshipSettings`, first), reminders (`NotificationsOptIn`), iqama timing (`IqamaSettings`).
  `CollapsibleSection` owns the header (icon tile + title/subtitle + rotating `ChevronDown`); the
  three section components render **body-only** now (their old internal headers were lifted into it).
  Height animates via the **grid-template-rows `0fr↔1fr`** trick (works with dynamic content — the
  rule list grows, `AlertForm` expands inline); content stays **mounted while collapsed** (only
  clipped) because `NotificationsOptIn` seeds its default rule from an effect that must keep running.
  `SlideOver`'s body is `overflow-y-auto overscroll-contain`. **No language toggle** (UI locked to
  Arabic — see §3; removed 2026-06-30). **The location quick-pick is not here** — it lives only in the
  search panel (`CitySearch`); removed from Settings 2026-06-20 as redundant (the location header
  already opens the picker). **No method picker and no Asr madhab toggle** (removed — `DECISIONS.md`
  ADR-002/003).
- `IqamaSettings` — five per-prayer stepper rows (Minus / value / Plus, clamped 0–60) editing
  `iqamaMinutes` via `useSettings().setIqama`; persisted to localStorage. Sunrise has no row.
- `WorshipSettings` — five **on/off switches** for the opt-in worship features (`features.{duha,
  qiyam,rawatib,adhkar,record}`, all off by default) via `useSettings().setFeature`. Section title
  **المزايا الاضافية**. Rows: صلاة الضحى, قيام الليل, الرواتب, الأذكار, السجل (`record` = fard check-in
  + score pill + stats/history, as one unit). Each row uses the reusable `ui/Toggle` switch (`role="switch"`, RTL-aware knob,
  emerald when on). Toggling off only **hides** the widget — `prayer.worship.v1` is untouched.
- `NotificationsOptIn` + `AlertForm` — enable/disable + a list of independent reminder **rules**
  (add/edit/delete; seeds one default rule on first enable); iOS "Add to Home Screen" hint when
  non-standalone (`NOTIFICATIONS.md`). `AlertForm` (2026-07-11) opens with a **«إشعار/منبه» kind**
  segmented control (`Bell`/`AlarmClock`; picking منبه pre-warms the alarm audio via
  `unlockAlarmAudio()`), and the before/after minutes offer a **«مخصص» custom stepper** (1–180)
  beside the 5/10/15/30 presets. Alarm rules show an `AlarmClock` icon in the list. Full-screen alarm
  behavior → §9 + `NOTIFICATIONS.md` §3b.
- `LanguageToggle` — **retained in code but no longer rendered** (the UI is locked to Arabic, §3).
  Kept for future re-enablement; not imported anywhere.

No footer credit (the GeoNames-attribution footer + `common.credit` key were removed — attribution
lives in `GEOCODING.md`).

---

## 6. PWA

`manifest.webmanifest` (name, icons, `display: standalone`, theme colours, RTL-aware) + `public/sw.js`
(push + notificationclick). Installable on Android/desktop; **required** for iOS web push.

---

## 7. Design preferences (carried from home — Tier-2 `feedback_ui_design`)

Premium, polished feel — pill shapes, subtle shadows, gentle glow, animated icons; components get
visual identity and breathing room. Compact cards (minimize vertical height, inline colored text over
progress bars). All icons in a set must be visually **unique**. (As of 2026-06-20 the time,
per-prayer, and next-event icons were intentionally **removed** for a cleaner, text-forward
header/cards; per-prayer icons remain only in the reminder picker (`AlertForm`).) Title-case labels. The user prefers
to **see layouts live and iterate** over rounds of description — expect to run the app and refine.

**Single-screen fit:** the whole main view is designed to fit a phone viewport **without scrolling**
(verified at 390×844 and 360×740) — budget vertical space for any new section, and trim gaps/paddings/
ring size before adding height. **True-centre** a row's middle element with a 3-column grid
(`grid-cols-[1fr_auto_1fr]`) so a start-side icon never shifts it off-centre. Keep ticking numbers from
jittering: **tabular figures + fixed digit width** (the countdown zero-pads to 2 digits — see §2).

---

## 8. Worship tracker (gamified, client-only — ADR-006)

**Opt-in (ADR-007, 2026-07-04):** every hero widget below is **off by default** and gated by a
per-feature switch in Settings → `features.{duha,qiyam,rawatib,adhkar,record}` (§4/§5). `record` gates
the whole gamification unit (per-card + hero check-in, score pill, stats/history sheet); the other four
gate their own widget. The `useWorshipLog` hook still runs unconditionally (it can't be conditionally
called, and `isFriday` derives from `worship.todayKey`) — only the render is gated, so a disabled
feature is invisible but its history in `prayer.worship.v1` survives and returns when re-enabled.

All state in **`prayer.worship.v1`** (own versioned envelope, `lib/worship-storage.ts` — isolated
from `prayer.app.v1` on purpose). Pure logic in `lib/`: `civil-day.ts` (DayKey = civil date in the
**location tz**; `localDayKey` extracted from `usePrayerTimes`), `worship-log.ts` (types, 29-point
rubric, immutable `applyMark`, `sectionComplete` + `WORSHIP_SECTIONS`), `worship-windows.ts`
(adhan-gate + midnight lock; null timestamps degrade to markable), `worship-stats.ts`
(score / **per-section streaks** / best / last7 / **last30** / **monthly** / totals — always derived),
`worship-vm.ts` (corner-ring + check-in view-models), `adhkar-data.ts` (dhikr texts from the user's
posters + `slotComplete`/`listProgress`), `prayer-names.ts` (`isFridayKey` + `prayerNameKey` — the
Friday الجمعة swap). One stateful hook: `useWorshipLog` (rollover via the existing 1 s tick; 62-day
compaction with **per-section `prefixStreaks`**; dhikr counts debounced 500 ms + pagehide flush).
**Tested**: `npm --prefix client test` (vitest, node env, pure modules only).

**Follow-ups (2026-07-03, second pass):**
- **Friday → الجمعة.** On a Friday civil day the Dhuhr label reads «الجمعة» everywhere a *today*
  prayer name shows (card, hero ring, check-in question, iqama bar, "بعد الجمعة" after-prayer adhkar)
  — `App` computes `isFriday = isFridayKey(worship.todayKey)` and threads one boolean down. Config
  surfaces (alert chips, rule descriptions, iqama settings) keep «الظهر». Server push mirrors this
  (NOTIFICATIONS §4). Points/rawatib semantics unchanged.
- **Rawatib ring never dims.** `CornerRing` gained `dimWhenIdle` (default true); the rawatib instance
  passes `false`, so it keeps full opacity + its sky stroke even when idle. Locked `RawatibSheet` rows
  dropped `opacity-45` (lock icon + flat border still distinguish them). Adhkar ring unchanged.
- **Manual adhkar check-off.** Each `AdhkarSheet` row is now a `div` = body button (opens the reader)
  + a trailing `CheckCircle2` toggle wired to `mark({kind:"adhkar",slot,done})` (mirrors the
  Duha/Qiyam satellite toggles), gated by the existing `canMark`. Lets a user record adhkar read
  outside the app without tap-counting.
- **Check-in popover.** `CheckinControl` now **portals** the 3-icon trio to `<body>` (the prayer-list
  `.card` sets `backdrop-filter` + a retained `animate-rise-in` transform, both of which trap
  `position:fixed` and cap z-index). On open it measures the trigger rect, dims the page with a
  `bg-black/60` backdrop, and renders a **pixel-identical clone** of the trigger (above the backdrop,
  pointer-events-none) so the source icon stays lit; the trio is centred on the icon and clamped
  on-screen. Body scroll locks; resize/Escape/backdrop close.
- **Stats: per-section streaks + history views.** `deriveStats.streaks` is a `Record<WorshipSection,
  number>` (fard = all 5 prayed; rawatib = all 5 slots; adhkar = the morning+evening pair; sunan =
  duha AND qiyam), carried past compaction by per-section `prefixStreaks`. Since v2 Phase 6
  `deriveStats` also exposes `heatmap62` (the master 62-day `DayScore` series — `last7`/`last30`
  are its tail), `perPrayer62` (retained-days-only per-fard masjid/home/missed counts; month folds
  excluded by design) and an enriched `MonthScore` (`perfectDays`/`masjid`/`home`/`missed`/
  `bestDayScore` — folds + retained days merged, `Math.max` for best). The **التقارير tab**
  (`pages/ReportsPage.tsx` + `components/reports/*`) renders it; `TrendChart` keeps the 3-chip
  switcher — **أسبوع** (7-day), **شهر** (`last30`, day-of-month labels every 5th), **أشهر**
  (`monthly`, ≤12, current gold). The hero `ScorePill` flame is the **fard** streak.

**UI (design 3 of the numbered preview — `/?design=N` in dev, number keys 1–8):**
- `ScorePill` (hero **bottom-center**, below the check-in row — moved from the top corner 2026-07-19;
  ⭐ today's pts · 🔥 streak) → opens the **التقارير tab** (v2 Phase 6;
  StatsSheet retired): `TodayCard` (ring /29 + feature-gated category rows — disabled categories
  omitted, never zeroed), `TrendChart`, `HeatmapCalendar` (weeks×7 column grid, emerald score
  scale, today outlined gold), `PerPrayerBreakdown` (stacked masjid/home/missed bars, check-in trio
  legend), `LifetimeTotals` (4 tiles + Levantine best-day date when the record is a retained day).
  `features.record` off → the tab shows only a CTA empty state that enables the record.
- **Corner rings** (`CornerRing`, physically pinned like the satellites, `top-[139px]` — raised
  2026-07-19 so the check-in box clears their captions — so they don't
  move when rows below appear): rawatib bottom-right (**sky**, "x/12" rakaat), adhkar bottom-left
  (**teal**, "x/2" = the daily pair; arc moves per dhikr item). Titles on TOP, caption below
  (next slot / "الصباح|المساء الآن"). **Complete → solid disc + bold white check** — the same
  fill-and-check applies to the Duha/Qiyam satellites via `SatelliteRing`'s `done` prop (tap toggles;
  caption time stays and is dimmed whenever the window is inactive).
- **Check-in**: on each **Home-strip** fard cell an icon after the *name* (`CheckinControl`: dashed
  circle → 3-icon popover; marked icon tap → transient tooltip + popover to correct; picking the
  current state again undoes it) — moved off the Times tab with its strip, 2026-07-19; `App` builds
  `checkinFor` and Home's `PrayerStrip` embeds it. In the hero, `HeroCheckinRow` asks "أين صلّيت X؟" (icon trio) for the
  latest passed fard — **suppressed while the iqama bar runs** (prayer hasn't happened yet), swaps
  to the "أذكار بعد الصلاة" chip once marked, gone when those adhkar are done.
- **Sheets** (`ui/BottomSheet` — bottom-anchored dialog; `SlideOver` stays for Settings/Search):
  `RawatibSheet` (5 slots, lock → dashed open → check +1), `AdhkarSheet` (daily pair + 5
  after-prayer rows → reader), `AdhkarReader` (tap-to-count: whole current-dhikr card is the tap
  target, counter ring, done/upcoming lists, auto-award +1 via `slotComplete`).
- `ui/MosqueIcon` — custom simple mosque glyph (lucide has none); masjid=gold, home=teal,
  missed=red everywhere.

**Layout budget (v2.1 as-built, 2026-07-19):** main ring **184px**; satellites overlay nudged down
18 px (the score pill vacated the top corners for the bottom-center); corner rings at `top-[139px]`;
hero `p-3`, flow `gap-1.5`, below-ring spacer `h-1.5`, page column `gap-2.5`; iqama bar narrows to
`max-w-[200px]` beside the corner rings; hero header shortened to
"المتبقي للأذان". Verified no-scroll at 390×844 **and** 360×740 with ALL features on (the iqama bar
and the check-in row never coexist by design).

---

## 9. Full-screen alarm (منبه, 2026-07-11)

An `alarm`-kind reminder rule (`NOTIFICATIONS.md` §3b) raises a phone-alarm-style overlay. Pieces:

- **`hooks/useAlarm`** — the trigger. Listens for the SW `message` `{ type:"prayer-alarm", payload }`
  (app open / notification tap) and, on mount, parses a cold-open `?alarm=<prayer>&t=<firedAt>` URL
  (then `history.replaceState`-strips it). Both drop alarms whose `firedAt` is **>5 min old**. Returns
  `{ alarm, dismiss }`; `App` renders `<AlarmOverlay>` last (above every sheet) when `alarm` is set.
- **`components/AlarmOverlay`** — `fixed inset-0 z-[100]`, radial-gold background, styled to read as a
  mobile alarm: a small ringing label (`AlarmClock` + prayer name), a **huge live clock** as the
  centerpiece (`Intl.DateTimeFormat` split into time + AM/PM, **Latin numerals**, `dir="ltr"`), the
  at-time body («حان وقت الصلاة», reused `next.now`), and a **swipe-up-to-dismiss** X button
  (`SwipeUpToStop`: vertical pointer-drag past a threshold → `onStop`; animated `ChevronsUp` hint;
  Enter/Space keyboard fallback; **no snooze**). On mount it starts the tone, loops `navigator.vibrate`
  where supported, and auto-dismisses after 5 min; wake lock is already global (`useWakeLock`). Only
  new string: **`alarm.stop`** («إيقاف»).
  On mount it starts the tone and **loops for 2 min**, then auto-dismisses if untouched.
- **`lib/alarm-sound` + `lib/alarm-sounds`** — the alarm plays a **user-selected MP3** (catalog in
  `lib/alarm-sounds`; files in `public/alarms/`, served at `/alarms/…`, never bundled). `alarm-sound`
  reuses one `HTMLAudioElement`: `startAlarm()` loops the selected tone (`getSelectedAlarmSrc()` reads
  `alarmSound` from storage), `stopAlarm()` stops+rewinds, `previewAlarm(src)` single-shots for the
  Settings picker. **Autoplay:** browsers block audio until the page has a user gesture, so
  `unlockAlarmAudio()` pre-warms the element — called by `AlertForm` (kind switch/save) **and** on the
  app's **first interaction** (`App` one-time `pointerdown`/`keydown` listener). If a push-triggered
  alarm still can't autoplay (e.g. cold-open from a notification, no gesture yet), `AlarmOverlay`
  **retries `startAlarm()` on every tap** until it catches. `AlarmSoundPicker` (Settings → reminders)
  lists the tones (generic «نغمة N» labels); tapping a row selects + previews it.
- **`index.css`** — `@keyframes alarm-pulse` + `.alarm-pulse` (a fixed fast pulse for the ringing icon,
  independent of the countdown-paced `--breath` driver the overlay sits above).

**Reach (hard web-platform limit — same on iOS & Android):** the full-screen alarm + MP3 + vibration
play **only while the app/PWA is open** (foreground, or a tab the OS keeps alive). There is **no local
background timer**; the trigger is a **server push** that wakes the service worker, which — when the
app is **closed** — can only show a **notification** (system sound + vibration, `requireInteraction`),
not the ringing MP3 or a full-screen takeover. Tapping that notification opens the app into the alarm.
A true closed-app alarm with a custom ring needs a **native wrapper** (Capacitor + Android
`AlarmManager` / iOS 26 AlarmKit) — **built for Android** (§10 + `NATIVE_ALARM_SPEC.md`). See
`NOTIFICATIONS.md` §3b.

---

## 10. Native app (Capacitor, offline-first — 2026-07-11)

The Android (Capacitor) build wraps the **same SPA** and adds true closed-app alarms + fully offline
compute. Full detail: `NATIVE_ALARM_SPEC.md`. Frontend-relevant pieces:

- **`lib/native.ts`** — `isNative()` (`Capacitor.isNativePlatform`), the typed `PrayerAlarm` plugin
  handle, and `loadNativeFacade()` which dynamically imports the **native-only chunk**
  (`src/native/api.ts`) via `import.meta.glob`, keeping the reused engine out of the web bundle
  (amended hard rule 3; `findstr /m astronomy` gate). Guard every native call with `isNative()`.
- **`src/native/`** (type-checked by `tsconfig.native.json` under server-compatible flags; the strict
  app tsconfig `exclude`s it): `local-times.ts` builds the `/api/prayer-times` payload on-device (reused
  engine via the Vite `node:module` shim + `iraq-calibration-browser`); `schedule.ts` turns local rules
  into a 7-day `ScheduledAlarm[]`, reusing the server's `buildPushPayload` text; `api.ts` re-exports both.
- **Offline seam** — `usePrayerTimes` computes locally when `isNative()`; the web fetch path is byte-for-
  byte unchanged.
- **Local rules** — `lib/local-alerts.ts` (localStorage `prayer.alerts.v1`) + `useLocalAlerts`; no push
  endpoint (Web Push is absent in the Android WebView). `useNativeAlarmScheduler` recomputes and
  `PrayerAlarm.replaceAll`s the OS alarms on rule/location/tone change and on app resume.
- **UI** — `SettingsPanel` renders `<NativeReminders>` (native) vs `<NotificationsOptIn>` (web); both
  share the extracted **`AlertRuleList`** (add/edit/delete + `AlertForm`, whose `initial` was widened to
  `AlertDraft`). `NativeReminders` adds the Android **permission-onboarding rows** (`useAlarmPermissions`
  → `PrayerAlarm.getState()`, re-checked on resume) for notifications / exact-alarm / full-screen /
  battery + an OEM notice, and seeds one default rule on first launch. New strings: `notify.perm*` +
  `notify.offlineNote` (AR+EN, approved 2026-07-11); launcher name «مواقيت الصلاة».
- The full-screen **ring** is a **native `AlarmActivity`** (not the web `AlarmOverlay`); the web overlay
  (§9) still handles the in-app foreground case and is opened from the native activity's `?alarm=` deep
  link.
- **Safe-area insets are owned by `MainActivity.initDeterministicInsets()`** (2026-07-19): it
  replaces Capacitor 8.4.1's conditional SystemBars listener (Chromium≥140 gate + async
  viewport-fit probe — on the Pixel that left the WebView under the gesture bar with zero-valued
  vars) with an unconditional one: WebView always edge-to-edge, real system-bar+cutout insets
  always injected as `--safe-area-inset-*`, IME-aware. CSS consumes them via
  `--inset-* = max(env(), var())` in `surfaces.css`. **Paired layout rule:** the app shell
  (`.breath-driver`) is `calc(100dvh − var(--inset-top))`, NOT `h-dvh` — body pads its top by the
  inset, so a full-dvh child overflows the bottom by exactly the top inset (this is what kept
  clipping the tab bar even after the vars worked). MainActivity also sets the WebView to
  `OVER_SCROLL_NEVER` (the horizontal overscroll-stretch broke the tab swipe) and the textZoom cap
  (§12).

## 11. «الاتجاهات» tab: qibla + nearest masjid (2026-07-14 — `QIBLA_MASJID_SPEC.md`)

Contents (2026-07-23): `qibla/QiblaCompass` (first) → `masjid/NearestMasjids`. Nothing else.

**The monthly table was REMOVED from the app on 2026-07-23** (user, shipped in 2.1.1/vc5): it had
been default-OPEN since 2026-07-19, so every visit to this tab rebuilt a whole month — on native
that is the engine computing ~30 days offline plus ~30 rows rendered — for a feature the user
judged unused. Deleted client-side: `components/times/{MonthTable,MonthNav}.tsx`,
`hooks/useMonthTimes.ts`, `native/month.ts` (+ its facade export/types), `fetchMonthTimes`, the
`MonthTimesResponse`/`MonthDayRow` types and every `times.*` string. **The server keeps
`GET /api/prayer-times/month`** (`month-payload.ts` + tests, still green) — no client calls it, and
it costs nothing idle, so bringing the table back is a revert, not a rewrite. Main bundle 421 → 415
kB, native chunk 185 → 183 kB.

With the table gone the tab is no longer about times, so it was **renamed «الاتجاهات»**
(user-approved 2026-07-23; EN "Directions") with a **compass** icon in place of the calendar-clock.
The internal `TabId` stays `"times"` — persisted tab state, pager order and deep links index by it.

The **today strip was removed** from this tab earlier (a duplicate of Home's; its per-prayer
check-ins moved to the Home strip — §8). The masjid list is server-filtered: husseiniyas (all spellings incl. Persian script),
موكب stations and مضيف halls never appear (`server/src/places/google-places.ts`, user rule —
`QIBLA_MASJID_SPEC.md` header).

- **`useCompassHeading` lives in TimesPage** (ONE sensor stream shared by the compass card and the
  masjid bearing arrows) and stops whenever the tab loses `active` (keep-mounted tabs) or the
  document hides. Accuracy chain: native `Compass` plugin (fused ROTATION_VECTOR + GeomagneticField,
  display-rotation remapped, ~20 Hz) → `deviceorientationabsolute` (W3C tilt-compensated formula +
  `/api/geo/declination`, cached per ~10 km in `prayer.declination.v1`) → iOS `webkitCompassHeading`
  (requestPermission MUST run inside the start-button tap — it is the FIRST await in `start()`) →
  `unavailable` = static mode (fixed rose, arrow at true bearing — never a needle from relative
  sensors). Headings smoothed on the unit circle (sin/cos EMA), emitted ≤20 Hz; the component
  unwraps angles so CSS transitions never spin the long way at 359→0. **Honest native accuracy
  (2026-07-19):** `CompassPlugin` merges the rotation vector's per-event heading-uncertainty
  estimate (`values[4]`, radians: ≤5°=high · ≤15°=medium · ≤30°=low · else unreliable) with the
  SENSOR_STATUS callback and reports the WORSE — a magnetically swamped device (Pixel 7 Pro case:
  171 µT ambient vs Earth's ~47) shows «بحاجة إلى معايرة» + the figure-8 hint instead of a false
  «دقة عالية». **Auto-start (2026-07-19):**
  the hook exposes `needsGesture` (true only on iOS-web, whose `requestPermission()` must run in a
  tap); a TimesPage effect starts the compass whenever the tab is `active` and `!needsGesture`, so
  everywhere else it starts itself with no button and never re-prompts. **Dial redesign:** upright
  cardinal letters (each glyph counter-rotated by `rot − angle`, riding the SAME 200 ms transition
  as the rose so the pair cancels every frame), an SVG arrow needle with the Kaaba glyph at its tip
  (also counter-rotated), no center degrees readout, `size-60` dial, DEV-only heading diagnostic.
- **`lib/qibla.ts`** is pure math (KAABA const, great-circle `bearingToKaaba` — Baghdad ≈ 199.8°,
  `haversineKm` mirroring `server/src/util/geo-distance.ts`). Lock-on at ±3°: gold ring + one
  haptic per alignment entry (`Compass.pulse()` native / `navigator.vibrate` web) + an aria-live
  announcement.
- **`NearestMasjids`** is gated on `location.source === "gps"` (additive `StoredLocation.source`
  migration). On the APK the fix comes from `@capacitor/geolocation` (§1 — the WebView path could
  never get one), and a denied/failed request surfaces `error.locationDenied`/`error.location`
  under the opt-in button via the `gpsErrorKind` prop (2026-07-19 — it used to fail silently).
  `enabled:false` from the proxy hides the section entirely. Rows: distance («850 م» / «1.2 كم»,
  Latin digits), live bearing arrow, Maps/Waze deep links (`<a target="_blank" rel="noopener noreferrer">`).
- **Cold-GPS resilience (2026-07-24, `lib/gps-staging.ts` — v2.1.2 · `QIBLA_MASJID_SPEC.md` Session 7).**
  The section used to error on the first cold visit: on a device with no recent fix (GNSS cold /
  indoors) BOTH staged-GPS timeouts expired before one landed, so `source` never became `"gps"` and
  it showed a location error until a fix eventually self-healed (this, NOT Samsung Auto Blocker,
  which was investigated live and RULED OUT — it only blocks wireless adb). `requestGpsStaged`
  (auto-run by TimesPage when the tab is active + permission granted) now **paints from the
  last-known position first** (`maximumAge` 5 min → 1 h), **falls back to a patient coarse attempt**
  (20 s) on a truly cold device, and runs the precise refine **SILENTLY** — a slow/failed precise
  lock never flashes an error over a list already painted. The orchestration is the pure,
  unit-tested `runStagedFix(requestFix)`. **Gotcha — `requestGps` returns `Promise<boolean>` (fix
  obtained?) and NEVER rejects** (it reports failures via UI state); the staging keys off the
  boolean, not exceptions. A code review caught the original exception-based version as dead code
  (the patient fallback was unreachable, the refine always silent) — do not build control flow on
  `requestGps` throwing. The masjid fetch also **retries once** (1.5 s) on a transient
  `degraded`/network failure before showing «تعذّر…», then clears the memo so the next visit retries.

## 12. Accessibility system (Phase 8, 2026-07-14 — ADR-010)

- **Focus**: one UNLAYERED `:focus-visible` rule in `styles/surfaces.css` consumes
  `--focus-ring-width/--focus-ring-color` (night 2px teal, contrast 3px gold). Never add
  `outline-none` without `.focus-ring-within` (wrapper inputs) / `.focus-ring-none` (inner opt-out).
- **Touch targets**: `.hit-target` (index.css) expands hit areas to ≥48 px via a transparent
  ::after; cap with `--hit-w`/`--hit-h` when a real neighbor sits closer (AlertRuleList delete must
  never cover edit). Known documented exception: ScorePill caps at 38 px (its vertical expansion
  would overlap the check-in row directly above it in the hero flow; the Reports tab is the
  redundant path to the same place).
- **Countdowns are silent**: every per-second text (hero clock, satellites, iqama, alarm clock) is
  `aria-hidden` inside a stable-named container (IqamaBar = `role="timer"`). The app has exactly ONE
  live region — `TipLiveRegion` in CheckinControl (check-in confirmations); keep it that way.
- **Dialogs**: BottomSheet/SlideOver/check-in popover move focus in on open and restore on close;
  no full trap (deliberate — aria-modal + Escape + backdrop suffice). lucide icons need no
  aria-hidden sweep (the lib injects it on childless icons).
- **Text size = the OS pipeline only** (the in-app «حجم الخط» control was REMOVED 2026-07-19 —
  ADR-012; web/desktop rely on native browser zoom). Android: MainActivity caps WebView
  `textZoom` at 130% of the system scale, and main.tsx MEASURES the effective zoom (DOM width vs
  canvas width — canvas text ignores textZoom) to stamp `data-syszoom="high"`: the px-fixed
  hero/TopBar/event rows then pin their type via the `fs125-*` classes (index.css, unlayered, at
  pulled-down values — textZoom re-zooms rem text), the hero gets EXTRA bottom padding (textZoom
  grows even px-sized corner-ring captions), and page cards get `flex-shrink: 0` — the extreme
  state scrolls instead of clipping (acceptance is "unclipped" at high zoom; strict no-scroll
  holds at normal scale; emulator-verified at system font_scale 2.0).
- **Per-theme contrast**: axe (devDep `axe-core`, injected via Playwright MCP `/@fs/`) must stay at
  ZERO violations; translucent themes file contrast as "incomplete" — resolve at TOKEN level
  against composited backdrops (glass mid = #dfe9f6). Every glass accent is AA-darkened; contrast
  theme splits critical/imminent (near-white #ffd1d1); night ink-faint = #75988f (user-approved).

## 13. Vendor prefixes: never hand-write `-webkit-backdrop-filter` (2026-07-22)

**The glass theme rendered with NO blur at all inside the Android WebView**, on every build since the
theme shipped — cards and tab bar alike. Desktop Chrome looked correct, which is why it survived
several review rounds.

Root cause: our CSS wrote the pair by hand, standard property first:

```css
backdrop-filter: blur(16px) saturate(185%);
-webkit-backdrop-filter: blur(16px) saturate(185%);   /* ← the problem */
```

Lightning CSS (Vite's minifier) collapsed the pair down to **only the `-webkit-` form**, and the
device's Chromium (Chrome 150 WebView) has dropped that legacy alias — so the declaration matched
nothing and `getComputedStyle(...).backdropFilter` returned `none`.

**Rule: write only the standard property.** The build adds the prefixes it needs; with the hand-written
line removed, the same rule now emits `-webkit-backdrop-filter` *and* `backdrop-filter`.

How it was found (repeat this for any "works on desktop, not in the APK" style bug) — CDP straight
into the device WebView, which is the only way to see the *computed* value on the real engine:

```bash
adb shell "cat /proc/net/unix | grep -o 'webview_devtools_remote.*'"   # socket name
adb forward tcp:9222 localabstract:<socket>
curl http://127.0.0.1:9222/json/list          # → webSocketDebuggerUrl
# then Runtime.evaluate over that WebSocket:
#   getComputedStyle(document.querySelector('.tab-bar')).backdropFilter
```

The decisive step was probing a scratch element with an inline `backdrop-filter: blur(10px)`: it
computed fine, proving the *engine* supported the property and the *stylesheet* was at fault.

### Glass tab-bar recipe (user-tuned on device, same session)

Glossy, not frosted — heavy blur smears away the refraction and reads as a grey panel:
flat `rgba(255,255,255,0.16)` fill (no sheen gradient — a diagonal ramp looked frostier at one end),
`--tabbar-blur: 4px`, the wide-band lens map, a `::before` specular sheen over the upper half, and a
restrained active pill (`0.34` alpha + `brightness(1.06)`) instead of a solid white chip.

**Safe-area rule:** a *docked* bar (night/material/contrast) takes the bottom inset as inner padding
so its background reaches the screen edge; a *floating* capsule (glass) must take it as
`margin-bottom` instead — as padding it inflates the capsule with a dead band under the icons.
Themes switch this via `--tabbar-safe-pad` / `--tabbar-safe-margin` (`surfaces.css`).
