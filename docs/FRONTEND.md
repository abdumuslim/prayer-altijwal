# Frontend

React 19 + Vite 7 + Tailwind 4 SPA. GPS-driven, bilingual (AR default, RTL-aware), live countdown,
installable PWA (required for iOS push). Design reference — no code yet.

Related: `ARCHITECTURE.md` (request/tz model), `DECISIONS.md` ADR-004 (localization), `GEOCODING.md`,
`NOTIFICATIONS.md`.

---

## 1. Location flow (`useLocation` + `lib/geolocation.ts`)

Fallback chain — never blocks the UI:
1. Persisted location in `localStorage` → render instantly.
2. Else "Use my location" → `navigator.geolocation.getCurrentPosition` → `GET /api/geo/reverse`
   → `{ city, country, tz, elevation, method }` → persist.
3. Else (permission denied/unavailable) → `CitySearch` (forward `/api/geo/search`).
4. Last resort → IP/browser-tz default (a sensible capital); always overridable.

The resolved `{ lat, lon, tz, method, asr }` feed `GET /api/prayer-times`.

---

## 2. Live countdown (`usePrayerTimes`)

Generalizes home's hook. Fetch the payload (absolute `timestamp`s) once per civil day / on change;
tick a local `setInterval(1000)` recomputing each `countdown` from `timestamp − Date.now()` and
re-deriving `isNext`/`isPassed` client-side, so the timer is smooth and never diverges from the
server. **Re-fetch** on: location/method/asr change, local-midnight rollover, tab refocus after
staleness. Proximity levels (for styling) mirror home: imminent ≤2 min, critical ≤4, urgent ≤7,
warning ≤15, else safe.

---

## 3. i18n + RTL (`i18n/I18nProvider`)

- Two flat dictionaries (`strings.ar.ts`, `strings.en.ts`) + a `t(key)` lookup. **No heavy i18n
  library** — keeps the bundle small (tech-assessment: fix patterns, don't add weight).
- **Arabic default.** On language change set `document.documentElement.lang` and `dir`
  (`rtl` for ar, `ltr` for en).
- Tailwind **logical properties** (`ms-`/`me-`/`ps-`/`pe-`, `start`/`end`) for RTL-safe layout —
  avoid hard `left`/`right`.
- **Numerals:** pick Arabic-Indic *or* Latin digits for time strings and use it consistently
  (avoid jarring mixed numerals); configurable via the formatter locale / `numberingSystem`.
- Persist `language`; initialize from stored value or `navigator.language`, defaulting to `ar`.

---

## 4. localStorage (`lib/storage.ts`, versioned)

Wrap in a versioned envelope `{ v: 1, ... }` for safe migrations. Keys:

| Key | Shape |
|---|---|
| `location` | `{ city, country, tz, lat, lon, elevation }` |
| `method` / `asr` | method key + asr madhab, with an `auto` flag = "follow country detection" |
| `language` | `"ar"` \| `"en"` |
| `reminderPrefs` | `{ enabled, leadMinutes: number[], prayers: string[] }` |

---

## 5. Components & hooks

**Hooks:** `usePrayerTimes`, `useLocation`, `useSettings`, `usePushSubscription`.

**Components:**
- `PrayerList` / `PrayerCard` — the six times; highlight `isNext`; proximity accent colour.
- `NextPrayerCountdown` — large live timer to the next prayer.
- `HijriDate`, `NextEvent` — Hijri date + next Islamic event.
- `LocationBar` — current city + active method; opens settings.
- `CitySearch` — debounced forward search (`/api/geo/search`).
- `SettingsPanel` — method picker showing **"Auto (detected: X)"** + manual override (reset-to-auto),
  Asr madhab toggle, language toggle.
- `NotificationsOptIn` — permission + per-prayer toggles + lead-time chips; iOS "Add to Home Screen"
  hint when non-standalone (`NOTIFICATIONS.md`).
- `LanguageToggle`.

---

## 6. PWA

`manifest.webmanifest` (name, icons, `display: standalone`, theme colours, RTL-aware) + `public/sw.js`
(push + notificationclick). Installable on Android/desktop; **required** for iOS web push.

---

## 7. Design preferences (carried from home — Tier-2 `feedback_ui_design`)

Premium, polished feel — pill shapes, subtle shadows, gentle glow, animated icons; components get
visual identity and breathing room. Compact cards (minimize vertical height, inline colored text over
progress bars). All icons in a set must be visually **unique**. Title-case labels. The user prefers
to **see layouts live and iterate** over rounds of description — expect to run the app and refine.
