---
type: Reference
title: 'Geocoding & location resolution'
description: 'How the app turns a GPS fix (or a typed city) into the four things the engine + UI need: IANA timezone (anchor the civil day + format), country (pick the method), display city name, and elevation. Design reference — no…'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# Geocoding & location resolution

How the app turns a GPS fix (or a typed city) into the four things the engine + UI need:
**IANA timezone** (anchor the civil day + format), **country** (pick the method), **display city
name**, and **elevation**. Design reference — no code yet.

Related: `ARCHITECTURE.md` (tz model), `DECISIONS.md` ADR-002 (method table), `PRAYER_TIMES_API.md`.

---

## 1. Recommended source: bundled GeoNames `cities15000` (offline)

A single offline dataset answers **reverse** (GPS → nearest city), **forward** (city search), **tz**,
**country**, and **elevation** — with **no API key, no rate limit, no network**, and full
privacy (coords never leave the server beyond the request).

- **File:** GeoNames `cities15000` (every city ≥ 15 000 population + all capitals; ~25 000 rows).
- **Raw size:** ~2.2 MB TSV. After pruning to the needed columns and JSON-encoding → ~3–4 MB,
  trivially bundled in the Docker image and loaded once into memory at boot.
- **Columns kept per row:** `name`, `asciiname`, `lat`, `lon`, `countryCode`, `admin1`,
  `timezone`, `elevation` (or `dem`), `population`.
- **License:** CC-BY 4.0 → attribution in this doc + a small UI credit.

Why `cities15000` and not 5000/500: 15000 is the smallest tier that still covers every capital and
all sizeable cities; for a prayer app the **nearest** ≥15k city is essentially always in the same
tz/country (tz boundaries are coarse), and the exact coords (from GPS) — not the city label — drive
the times. 5000/500 are larger files for negligible accuracy gain here.

### Build step (one-time, reproducible)
`server/scripts/build-cities.mjs` (run at image build, or commit the output): download
`cities15000.zip` from `download.geonames.org/export/dump/`, parse the TSV, keep the columns above,
encode to `server/data/cities15000.json`. Document the regenerate command in `README.md`.

---

## 2. Reverse — GPS → city/tz/country/elevation

`geo/cities-index.ts` loads the JSON once and answers nearest-neighbour by great-circle (haversine)
distance. 25k points → a linear scan is sub-millisecond, but use a simple **lat-band bucket index**
(bucket by `floor(lat)`, search ±2 bands) to keep it clean.

```
GET /api/geo/reverse?lat&lon
  → { city, cityAr, country, admin1, tz, elevation, method }
```

`method` is `method-detect.ts` applied to the resolved `country` (for IQ → the calibrated Iraqi
profile country-wide; see `DECISIONS.md` ADR-002, reversed — no Baghdad radius). `cityAr` is the
matched city's Arabic-script name (or `null`); the client shows it in Arabic mode. The UI shows
"Nearest: {city}" wording so a far nearest-city in sparse regions doesn't surprise users — the
**times are still exact** because they use the GPS coords.

---

## 3. Forward — city search

Primary (offline): case- and diacritic-insensitive prefix/substring match over `name` + `asciiname`
in the same in-memory dataset, ranked by `population` desc, top ~8.

```
GET /api/geo/search?q&lang
  → { results: [ { name, nameAr, country, admin1, tz, lat, lon, elevation, population } ] }
```

`nameAr` is the Arabic-script city name (or `null`); Arabic queries also match it (`search()` includes
`nar` in its haystack). Optional fallback (online): if **zero** offline hits and the network is
available, call **Open-Meteo
geocoding** (`https://geocoding-api.open-meteo.com/v1/search?name=&count=8&language={ar|en}`) — free,
no key — which returns `name, latitude, longitude, elevation, country_code, admin1, timezone,
population`, mapped 1:1 to our candidate shape. This covers rare/misspelled names without making
Open-Meteo a hard dependency. (Home already uses Open-Meteo for weather, so it's a known-good source.)

---

## 3a. Governorate quick-pick — a country's admin-1 capitals

The location picker that **replaced the manual method override**: rather than typing, pick your
governorate from a list. `CitiesIndex.governorates(cc)` returns **one representative city — the most
populous — per first-level admin division** of the country, sorted by population. The route caps the
list (40) to cover every country's admin-1 set.

**Iraq is curated, not heuristic.** The most-populous-per-`adm1` rule surfaced wrong/ugly seats for IQ —
GeoNames metro/district features outrank the real capital: `Al Mawsil al Jadidah` (new) and
`Al Basrah al Qadimah` (old) instead of Mosul/Basra, `Khanaqin` instead of Diyala's seat Baqubah,
`Bayji` instead of Tikrit — plus the small Halabja governorate the product doesn't want listed. So for
`cc==="IQ"`, `governorates()` returns a fixed **18-row capitals table** (`server/src/geo/iq-governorates.ts`,
Halabja intentionally omitted) with clean Arabic names; every **other** country still uses the heuristic.
This is an Iraq calibration analogous to the `BaghdadYMA` method profile. **Reverse-geocoding and search
are unaffected** — Halabja, Khanaqin and the "new/old" districts stay in `cities15000.json` and remain
searchable; only the quick-pick is curated. Regression: `geo.test.ts` asserts the curated set (Baqubah,
Mosul, Basra present; no Halabja/Khanaqin/`jadidah|qadimah`).

```
GET /api/geo/governorates?country={ISO-2}
  → { governorates: [ { name, nameAr, country, admin1, tz, lat, lon, elevation, population } ] }
```

**Calibration-gov resolution (separate concern).** The prayer-time **Waqf calibration**
(`prayer/iraq-calibration.ts`, see `PRAYER_ENGINE.md` §4) keeps its **own** nearest-of-15 list (the 15
govs the official poster covers — incl. Fallujah/Samarra, which aren't in the 18-row quick-pick). Any
Iraqi GPS point snaps to the nearest of those 15 for its per-prayer offset; the exact-data override
fires only when the point is **≤45 km** from a capital. This is independent of `governorates()` /
reverse-geocode — it maps coordinates → calibration profile, not coordinates → display city.

Shape = the same `GeoResult` as forward search. Offline-only (no external call). `country` is a
required 2-letter code (`GeoGovernoratesQuery`). Surfaced in **both** the city-search panel (the
default list when the query is empty) and Settings, via the shared `GovernorateList` component;
selecting one sets the location.

---

## 4. Method detection

`method-detect.ts` maps the resolved `country` → method using the table in `DECISIONS.md` ADR-002
(IQ→BaghdadYMA, EG→Egyptian, SA→UmmAlQura, TR→Diyanet, US/CA→ISNA, … else MWL). For **IQ the
calibrated Iraqi profile applies country-wide** — `detectMethod` short-circuits on `cc === "IQ"`, no
radius check (ADR-002, reversed). The method is **not user-overridable** any more (the picker was
removed); it is auto-resolved server-side and returned for display logic only.

---

## 5. Why `tz` comes from here, not the device

The device's `Intl...timeZone` is the *device's* tz and is wrong for any remote/searched location.
The civil-day anchor and the display formatting must use the **target location's** tz, which only the
geocoding step knows. So `reverse`/`search` return `tz`, and the client passes it to
`/api/prayer-times`. The device tz is used only as a weak last-resort default (pre-select a sensible
capital when GPS is denied and nothing is stored). See `ARCHITECTURE.md` §3.

---

## 6. Fallback chain (client) — see `FRONTEND.md`

persisted location → `navigator.geolocation` → manual city search → IP/browser-tz default. The UI
never blocks; a clear "Set your location" affordance is always available.

---

## As-built notes (MVP)

- Built dataset: `server/data/cities15000.json` (~33,868 cities, ~6.5 MB), regenerate with
  `npm --prefix server run build:cities` (`server/scripts/build-cities.mjs`).
- **Compact row schema** (to shrink the file): `{ n:name, a:asciiname, lat, lon, cc:countryCode,
  adm1:admin1, pop:population, tz:timezone, ele:elevation|dem|null, alt?:Latin alternate names,
  nar?:Arabic name }`.
- The extra **`alt`** field (comma-joined Latin-script GeoNames alternate names) lets exonym search
  work (e.g. "Mecca" → Makkah, "Zurich" → Zürich) without per-city hardcoding; non-Latin scripts are
  dropped (the native form is already in `n`). `search()` matches over `n`, `a`, `alt`, and `nar`.
- **`nar`** (Arabic-script name) is a lightweight addition — `build-cities.mjs` extracts the **first
  Arabic-script token** from GeoNames `alternatenames` (no extra download). Coverage: 12,249 of 33,868
  cities have `nar` (95/100 Iraqi cities). It powers Arabic display (`nameAr`/`cityAr`) and Arabic-query
  matching. Country names are localized separately on the client via `Intl.DisplayNames` (`lib/locale.ts`).
- `CitiesIndex.governorates(cc)` backs `/api/geo/governorates` (the governorate quick-pick): most-populous
  city per admin-1, sorted by population — **except `IQ`, served by the curated capitals table**
  (`iq-governorates.ts`; see §3a).
- `reverse` uses the **request** lat/lon for method detection (not the matched city's centroid).
  `admin1` is returned as the raw GeoNames code.

## Attribution

City data © GeoNames (CC-BY 4.0), `https://www.geonames.org/`. Optional search fallback via
Open-Meteo geocoding, `https://open-meteo.com/`.
