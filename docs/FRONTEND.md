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
   `navigator.geolocation.getCurrentPosition` → `GET /api/geo/reverse`
   → `{ city, cityAr, country, tz, elevation, method }` → persist.
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
begins. The hero's only animated glow is the **soft radial halo** behind the ring (the `<div>` whose
`background` is the proximity accent) — it **breathes** via the `halo-breath` keyframe (**scale + opacity** — spreads
between ~40% and ~95% of its area, opacity floored so it never fully fades), and
its **speed ramps with the countdown**: a calm, barely-noticeable slow breath when far off,
accelerating each minute from the 15-min mark until it matches the last-minute pulse.
`glowBreathPeriod(ms)` (`lib/format.ts`) maps the remaining minutes to `--glow-period` (~14s far → 1s
at the last minute), **bucketed to whole minutes** so it re-times once per minute, not every tick (no
jitter). **No card-edge/border glow** — by request the hero card does not glow its border in any state
(the section keeps only the `rise-in` entrance + the static `.card` depth shadow). **Gotcha:** never
stack two `animate-*` utilities on one element — both set the `animation` shorthand and the later one
silently wins (this once killed the hero glow); the halo breath lives on its **own** element, so it
never clashes with the section's `rise-in`. The **prayer rows** stay calm while far off — the next-row
glow is suppressed in the `safe` (>15 min) state and only the colored/pulsing glow kicks in as the
prayer approaches. Colour vars live in `index.css`.

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
- Persist `language`; initialize from stored value or `navigator.language`, defaulting to `ar`.

---

## 4. localStorage (`lib/storage.ts`, versioned)

Wrap in a versioned envelope `{ v: 1, ... }` for safe migrations. Keys:

| Key | Shape |
|---|---|
| `location` | `{ city, cityAr?, country, tz, lat, lon, elevation }` |
| `language` | `"ar"` \| `"en"` |

Method/asr are **not** persisted from a picker any more (auto-resolved server-side; no UI). Reminder
selections are **server-side** (alert rules) — no `reminderPrefs` key.

---

## 5. Components & hooks

**Hooks:** `usePrayerTimes`, `useLocation`, `useSettings`, `usePushSubscription` (lifecycle + exposes
the `endpoint`), `usePrayerAlerts(endpoint)` (the reminder rules — `NOTIFICATIONS.md`), `useWakeLock`
(holds a Screen Wake Lock so the phone screen doesn't sleep while the app is open; feature-detected,
re-acquires on `visibilitychange` since browsers drop the lock when the tab hides; silent no-op where
unsupported — no UI, called once in `App`).

**Components:**
- `TopBar` — single consolidated header row, a **3-column grid** (`grid-cols-[1fr_auto_1fr]`) so the
  **location is truly centred** regardless of the side widths: **[settings][live local time, no icon]**
  at the start, the centred location (Arabic name in Arabic mode; opens search), and **both dates**
  (Hijri + **Levantine** Gregorian, centred stacked column) at the end. Time + dates are sized up to fill the row height the
  2-line location sets (no taller row). The centred location is visibly tappable — a trailing
  `ChevronDown` + a hover pill signal "change location". Replaced the old `LocationBar` + `NowCard`.
- `PrayerList` / `PrayerCard` — the six times as a compact **2-column grid** (3 rows). Each box is a
  **single vertically-centred row** with **generous vertical padding** (`py-5`, breathing room):
  `[name]` at the start (per-prayer icon removed; name is `text-base` with `leading-snug` — tight
  `leading-none` clipped Arabic descenders under `truncate`, see §3),
  `[clock time / remaining]` as a centred stacked column at the end. The
  countdown shows for **every upcoming** prayer (next = proximity accent + glow/border, others calm,
  passed dim).
- `NextPrayerCountdown` — live timer to the next prayer inside a depleting ring (**208px**): a single header line
  (`next.header` "الوقت المتبقي للاذان القادم", or `next.now` at adhan) + name + countdown + clock
  time. The three inner lines are **distributed vertically** (height-constrained `justify-between`) so
  they breathe without touching the ring. RTL-safe centred glow.
- `NextEvent` — next Islamic event (bottom card; only when an event exists), a **3-column grid** so the
  event name is **truly centred**: the label (`event.next`) at the start (**no icon**) · event name
  centred · the event **date over the days-left chip** (centred stacked column) at the end. The date is
  the **Hijri (Umm al-Qura)** date of `now + daysLeft` in the location tz (`lib/hijri.ts`), matching the
  header's Hijri line.
- `CitySearch` — debounced forward search (`/api/geo/search`); a **"Use my location" (GPS)** button +
  the **governorate list** as its default when the query is empty.
- `GovernorateList` — list of the country's governorate capitals (`/api/geo/governorates`), shown
  **in `CitySearch` only**; selecting one sets the location. **This replaced the manual method/Asr controls.**
- `SettingsPanel` — the reminders section and language toggle. **The location quick-pick is not here** —
  it lives only in the search panel (`CitySearch`); removed from Settings 2026-06-20 as redundant (the
  location header already opens the picker). **No method picker and no Asr madhab toggle** (removed —
  `DECISIONS.md` ADR-002/003).
- `NotificationsOptIn` + `AlertForm` — enable/disable + a list of independent reminder **rules**
  (add/edit/delete; seeds one default rule on first enable); iOS "Add to Home Screen" hint when
  non-standalone (`NOTIFICATIONS.md`).
- `LanguageToggle`.

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
