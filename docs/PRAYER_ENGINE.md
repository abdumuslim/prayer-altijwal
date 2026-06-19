# Prayer Engine (reused from home)

The prayer-time calculation is **not** re-implemented here. It is the production-tested,
location-agnostic `prayer-engine` from the home project, **copied verbatim** into
`server/src/prayer-engine/` and **never edited**. This doc records what it is, how to call it, and
the two location-specific things home does that this project must do differently.

Source of truth: `D:\dev\home\server\src\prayer-engine\` (and its `README.md`).

---

## 1. What it is

- Pure TypeScript on a single dependency: **`astronomy-engine`** (Don Cross, MIT) — ~1 arcminute
  solar position, elevation-aware rise/set.
- **Location-agnostic.** It hardcodes no coordinates, timezone, or method. All Baghdad specifics in
  home live *outside* the engine (in `prayer.ts` and the route handler) — which is exactly why it
  drops cleanly into a multi-location app.
- All returned instants are **absolute UTC `Date`s**. Display formatting is the caller's job.

Files (copied as-is): `index.ts`, `astro.ts`, `methods.ts`, `asr.ts`, `high-latitude.ts`,
`sunnah.ts`, `timezone.ts`, `rounding.ts`, `types.ts`, `calibrate.ts`, `prayer-engine.test.ts`,
`README.md`.

---

## 2. Entry point

```ts
function calculatePrayerTimes(
  coords: { latitude: number; longitude: number; elevation?: number },
  date: Date,
  config?: {
    method?: string | MethodParams;   // preset name or inline angles; default "MWL"
    asr?: "Standard" | "Hanafi";      // default per method (Standard)
    highLatitudeRule?: "None" | "NightMiddle" | "OneSeventh" | "AngleBased";
    elevation?: boolean | number;     // false=sea level, number=metres, true/omit=use coords/method
    timezone?: string;                // IANA tz, anchors the civil day; default "UTC"
    adjustments?: Partial<Record<TimeName, number>>;  // per-prayer minute offsets
    rounding?: RoundingConfig;        // per-prayer rounding
    sunnah?: SunnahConfig;            // opt-in: imsak, midnight, first/last third, duha
  },
): PrayerTimesResult   // { fajr, sunrise, dhuhr, asr, maghrib, isha : Date }  (+ optional sunnah)
```

The `timezone` only selects **which civil day** to compute (via `zonedMidnightUtc`); it does not
shift the returned UTC instants. Format with the same tz for display.

---

## 3. Method presets (13)

From `methods.ts`. Angles are solar depression degrees; `{ minutes }` Isha is a fixed interval
after Maghrib.

| Key | Authority | Fajr | Isha | Notes |
|---|---|---|---|---|
| `MWL` | Muslim World League | 18° | 17° | global default |
| `ISNA` | North America | 15° | 15° | |
| `Egyptian` | Egyptian Survey Authority | 19.5° | 17.5° | |
| `UmmAlQura` | Makkah | 18.5° | Maghrib + 90 min | |
| `Karachi` | Univ. Islamic Sciences | 18° | 18° | |
| `Dubai` | Dubai | 18.2° | 18.2° | |
| `Qatar` | Qatar | 18° | Maghrib + 90 min | |
| `Kuwait` | Kuwait | 18° | 17.5° | |
| `Singapore` | MUIS | 20° | 18° | |
| `Diyanet` | Turkey | 18° | 17° | |
| `Tehran` | Geophysics, Tehran | 17.7° | 14° | Maghrib angle 4.5° |
| `Jafari` | Shia Ithna-Ashari | 16° | 14° | Maghrib angle 4° |
| `BaghdadYMA` ⚠️ | Iraqi Sunni Endowment | 18° | 17° | **calibrated, applied country-wide — see §4** |

Asr madhab: `Standard` (shadow factor 1; Shafi/Maliki/Hanbali) or `Hanafi` (factor 2; ~30+ min later).
The engine still supports both, but the app always uses `Standard` (the Hanafi/madhab UI was removed —
`DECISIONS.md` ADR-002/003).

---

## 4. BaghdadYMA calibration — the nationwide Iraqi policy ⚠️

`BaghdadYMA` is **MWL angles (18/17) + Standard Asr** with extra calibration tuned to the Iraqi Sunni
Endowment's printed 2026 calendar (ديوان الوقف السني / jāmiʿat al-shubbān al-muslimīn):

```
elevationMeters: 34
adjustments:     { dhuhr: +5, asr: +3, maghrib: +2 }   // minutes
rounding:        { fajr: "down" }                      // Fajr floors to the minute
// Result: ≤1 min vs the printed Baghdad calendar, mean ≈0.12 over 38 dates; locked by prayer-engine.test.ts
```

**Policy for this app (`method-detect.ts`): apply this calibrated profile to the WHOLE of Iraq**
(cc=IQ), not just Baghdad. The offsets turned out to be a *national* convention: the official
**ديوان الوقف السني per-governorate poster (4 Muharram 1448 / 19 June 2026)** is computed with one
unified Iraqi method, and our profile reproduces it country-wide. `detectMethod("IQ", …)`
short-circuits to `BaghdadYMA` with `baghdadCalibrated: true` for any Iraqi location (no radius check);
`compute.ts` uses the baked-in 34 m everywhere in Iraq. (This **reverses** the old Baghdad-only rule in
`DECISIONS.md` ADR-002.)

**Poster regression — `server/src/prayer/iraq-governorates.test.ts`:** evaluates the profile at 15
governorate capitals' own coordinates and asserts it matches the poster within physically-motivated
per-prayer tolerances:

| Prayer | Tolerance | Why |
|---|---|---|
| dhuhr, asr | ≤2 min | elevation-independent |
| fajr, isha | ≤2 min | depression angles, weakly elevation-sensitive |
| sunrise, maghrib | ≤3 min | horizon dip ∝ √elevation; profile fixed at 34 m vs each city's own elevation |

Baghdad itself matches to ≤1 min. The engine is **still untouched** (hard rule below) — only the
wrapper's *selection policy* changed (which preset + that it now covers all of Iraq). This is the
modeling-philosophy the user values: one calibrated general model, validated against the official
authority — not a per-city fudge. Rationale in `DECISIONS.md` ADR-002.

---

## 5. Hard rules (do not violate)

- **Never edit the copied engine.** Calibrate/extend via `config` (method, adjustments, rounding) in
  *our* wrapper modules, not inside `prayer-engine/`. If the engine improves upstream in home,
  re-copy the folder.
- **`astronomy-engine` is server-only.** `astro.ts` loads it via Node's `createRequire` (the dual
  CJS/ESM package resolves inconsistently otherwise). It must **never** be imported into the
  client bundle. Keep a guard that `client/` never imports `prayer-engine/`.
- **All engine times are UTC.** Always format with the target location's tz.
- **Default a high-latitude rule** (`AngleBased`) for the public app so users above ~48° never get
  `Invalid Date`.

---

## 6. Our thin wrappers (planned, not the engine)

| Module | Purpose |
|---|---|
| `prayer/compute.ts` | `computePrayerTimes(coords, tz, method, asr, date)` → calls `calculatePrayerTimes` |
| `prayer/method-detect.ts` | country → method (table in `DECISIONS.md`); IQ → calibrated profile country-wide (no radius rule) |
| `prayer/payload.ts` | the generalized payload builder (`PRAYER_TIMES_API.md`) |
| `prayer/format.ts` | `fmtTime(date, tz)`, `fmtCountdown(ms)`, `dateKey(date, tz)`, `minuteOfDay(date, tz)` |
| `prayer/hijri.ts` | `hijriDate(date, tz)`, `nextIslamicEvent(date, tz)` |
| `prayer/events.ts` | the 10 Islamic events + Hijri month-day constants |

These replace home's Baghdad-pinned `prayer.ts` + the hardcoded bits of `getPrayerTimesPayload`.
