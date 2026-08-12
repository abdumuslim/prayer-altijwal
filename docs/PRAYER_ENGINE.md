---
type: Reference
title: 'Prayer Engine (reused from home)'
description: 'The prayer-time calculation is not re-implemented here. It is the production-tested, location-agnostic prayer-engine from the home project, copied verbatim into server/src/prayer-engine/ and never edited. This doc…'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

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
elevationMeters: 34   // FALLBACK only — see elevation note below
adjustments:     { dhuhr: +5, asr: +3, maghrib: +2 }   // minutes
rounding:        { fajr: "down" }                      // Fajr floors to the minute
// Result: ≤1 min vs the printed Baghdad calendar, mean ≈0.12 over 38 dates; locked by prayer-engine.test.ts
```

**Policy for this app (`method-detect.ts`): apply this calibrated profile to the WHOLE of Iraq**
(cc=IQ), not just Baghdad. The offsets turned out to be a *national* convention: the official
**ديوان الوقف السني per-governorate poster (4 Muharram 1448 / 19 June 2026)** is computed with one
unified Iraqi method, and our profile reproduces it country-wide. `detectMethod("IQ", …)`
short-circuits to `BaghdadYMA` with `baghdadCalibrated: true` for any Iraqi location (no radius check).
(This **reverses** the old Baghdad-only rule in `DECISIONS.md` ADR-002.)

**Per-city elevation:** `compute.ts` passes each location's **real elevation** (governorate/city
dataset `ele`, or GPS) to the engine for **every** method, BaghdadYMA included — the baked-in 34 m is
only the fallback when no elevation is known. This fixes the sunrise/maghrib horizon dip for
non-Baghdad governorates (Mosul 228 m, Kirkuk 346 m, Basra 4 m); Baghdad's real ~41 m ≈ 34 m so the
anchor is unchanged.

**Per-governorate calibration (`server/src/prayer/iraq-calibration.ts`, 2026-06-24; corpus expanded
to the full year 2026-08-12).** The flat `+5/+3/+2` in `methods.ts` is the engine's *fallback*; our
wrapper **overrides it per governorate**. `computePrayerTimes` (for BaghdadYMA only) looks up the
**nearest of 15 calibrated governorates** and passes that gov's per-prayer `{offset, rounding}` as
`config.adjustments` / `config.rounding`. The table (`server/data/iraq-waqf-calibration.json`) is fit
by `scripts/build-waqf-calibration.ts` against the **full-year official archive**
(`server/data/waqf-times-2025-08-11-to-2026-08-11.json`, **366 dates** with per-date provenance:
**263** current-period Facebook cards, **41** previous-year cards re-keyed to the dates they were
actually printed for, and **62** generated fill-ins that are **SKIPPED as circular** ground truth)
merged with the original `_waqf_*.json` corpus + the 19-June-2026 poster → **321 verified dates ×
15 govs** after adjudication. Results (leave-one-**date**-out cross-validation over the merged
corpus): **85.8 % exact-to-the-minute, 99.8 % within ±1 min**, worst per-gov error ≤5 min (Baghdad
≤2). A **seasonal** (declination) term was re-tested on the full year and is negligible (**max drift
0.26 min across the 46.9° span**), so a per-gov **constant** remains the calibrated — not-overfit —
model.

**Adjudications overlay (`server/data/waqf-archive-adjudications.json`, 2026-08-12; `DECISIONS.md`
ADR-017).** The raw OCR archive and the `_waqf_*.json` files stay **pristine** — every correction and
exclusion lives in one image-verified overlay, applied identically by BOTH
`scripts/build-waqf-calibration.ts` and the integrity-sweep `scripts/analyze-waqf-archive.ts` (added
this session). Four lists: **1199 archive cell corrections + 23 old-corpus corrections** (the earlier
OCR pass had systematic +10-minute whole-row errors across multi-day runs; three rounds of
independent vision re-reads + 5–10× crop adjudication fixed them), and **2 excluded dates + 117
excluded cells** where the **Waqf's own poster is defective** — a wrong-day card (2025-08-11), a file
that prints the next day's card (the 2025-09-20 image is the 21-Sep card), ~15 out-of-season or
duplicated columns (e.g. a mid-winter Basra column pasted into 2026-08-05), two Baghdad hero
misprints (2025-09-28 isha 19:01, 2026-04-20 isha 20:40), and truncated cells. **Policy:** a printed
value **within ±5 min** of the calibrated model is served **verbatim** (it is the official
announcement); **beyond ±5 min** it is a print defect and is **excluded** (the formula serves that
cell). Excluded rows are suppressed from **both** corpora before the fit, so a defective value cannot
re-enter via the old-corpus transcription of the same poster.

> **Split for browser reuse (2026-07-11).** `iraq-calibration.ts` is now a **thin server loader**
> (`readFileSync` + pino) over a pure, data-injected **`iraq-calibration-core.ts`** (no Node APIs).
> The native app reuses the core in-browser via `client/src/native/iraq-calibration-browser.ts`
> (ESM-imports the same JSON). Behavior-neutral — the split kept all server tests green unchanged.
> Public signatures (`iraqCalibration`/`iraqExactTimes`/`baghdadInstant`) are identical, so callers
> and the poster regression are untouched. See `NATIVE_ALARM_SPEC.md` §3a/§3b.

**Exact-data override (literal 0-min) — `iraqExactTimes` + `server/data/waqf-exact.json`.** For a
location **at a governorate capital** (≤45 km) on a **digitized date**, `payload.ts` overlays the
official poster numbers **verbatim** → a literal 0-shift match. Everything else uses the calibrated
formula above. This realizes the "hybrid" the 2026-06-23 study concluded was required: **no formula can
reproduce the closed "Accurate Times" table to the minute** (its own sources jitter ±1; method
parameters independently confirmed by the *Iraqi Journal of Science* + IAC: Fajr 18°/Isha 17°, Standard
Asr, refraction term −0.8333−0.0347√H). Both data files are **generated, never hand-edited**; re-run the
build script after editing the `_waqf_*.json` corpus or the adjudications overlay. `waqf-exact.json`
is now **~900 KB** (321 dates × 15 govs) and is also bundled into the **native app's offline chunk**
(the on-device engine reads the same table). The old note that this override "surfaces poster typos
(Basra maghrib 22 Jun, Amarah 22 Jul)" was wrong: those were **transcription** errors — the posters
print the correct values — and the single audited record of **real** Waqf print defects is now the
adjudications overlay above.

**Year-recycle exact fallback (`iraq-calibration-core.ts`, 2026-08-12; `DECISIONS.md` ADR-017).**
When `waqf-exact.json` has **no entry** for the requested date, `iraqExactTimes` serves the **same
month-day up to 3 years back**, verbatim (a Feb-29 target falls back to Feb-28 of each earlier year;
an exact-date entry always wins over a recycled one). Justification: the Waqf treats its table as
**annual** — it reposted previous-year cards **41 times** in the archived year — and measured
same-Gregorian-date drift is **≤0.42 min** at these latitudes, so a recycled poster value is within
±1 min of what the next poster prints; the **3-year cap** ages out a possible method change. This is
what lets dates **beyond the archive's end** serve official numbers instead of the formula. Recycled
values additionally skip, per-prayer, any cell whose printed value deviated **≥3 min** from the model
on the source date (the `noRecycle` map in `waqf-exact.json`) — a one-day print oddity is served on
its own date but never propagated to future years. The function is pure/browser-safe, so the native
app recycles offline too.

**Poster regression — `server/src/prayer/iraq-governorates.test.ts`:** evaluates the **calibrated
formula** at 15 governorate capitals' own coordinates + elevation (the live path) against the
19-June-2026 poster, and separately asserts the **override** reproduces every gov verbatim (0 min):

| Prayer | Formula tolerance | Why |
|---|---|---|
| dhuhr | ≤1 min | elevation-independent, well-calibrated |
| fajr, asr, maghrib, isha | ≤2 min | depression angles / per-gov offset; residual ±1 is the Waqf's own jitter |
| sunrise | ≤3 min | kept for now, but the old "the Waqf handles dip differently at high elevation (Kirkuk 346 m)" claim was a **transcription artifact** — the re-verified Kirkuk sunrise (04:43) matches the engine exactly |

Baghdad matches to ≤1 min; the **override** is exact (0). The poster fixture itself was re-verified
**2026-08-12 at 6–10× zoom** against the byte-identical original photo, correcting **eleven** 1-minute
transcription errors (incl. a swapped Nasiriyah/Tikrit sunrise pair and Kirkuk sunrise 04:46→04:43);
Baghdad's row was already correct. The engine is **still untouched** (hard rule below) — only the
wrapper calibrates via `config`. This is the modeling philosophy the user values: one calibrated
general model + an official-data overlay, validated against the authority. Rationale in
`DECISIONS.md` ADR-002 and ADR-017.

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
