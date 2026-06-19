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
  → { city, country, admin1, tz, elevation, method }
```

`method` is `method-detect.ts` applied to the resolved `country` (+ the Baghdad-radius rule from
`DECISIONS.md` ADR-002). The UI shows "Nearest: {city}" wording so a far nearest-city in sparse
regions doesn't surprise users — the **times are still exact** because they use the GPS coords.

---

## 3. Forward — city search

Primary (offline): case- and diacritic-insensitive prefix/substring match over `name` + `asciiname`
in the same in-memory dataset, ranked by `population` desc, top ~8.

```
GET /api/geo/search?q&lang
  → { results: [ { name, country, admin1, tz, lat, lon, elevation, population } ] }
```

Optional fallback (online): if **zero** offline hits and the network is available, call **Open-Meteo
geocoding** (`https://geocoding-api.open-meteo.com/v1/search?name=&count=8&language={ar|en}`) — free,
no key — which returns `name, latitude, longitude, elevation, country_code, admin1, timezone,
population`, mapped 1:1 to our candidate shape. This covers rare/misspelled names without making
Open-Meteo a hard dependency. (Home already uses Open-Meteo for weather, so it's a known-good source.)

---

## 4. Method detection

`method-detect.ts` maps the resolved `country` → method using the table in `DECISIONS.md` ADR-002
(IQ→BaghdadYMA*, EG→Egyptian, SA→UmmAlQura, TR→Diyanet, US/CA→ISNA, … else MWL), with the
**Baghdad-only offset** rule (`*` full BaghdadYMA inside Baghdad's radius; MWL-angles elsewhere in
Iraq). The user can always override via the picker (`FRONTEND.md`), persisted in `localStorage`.

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
  adm1:admin1, pop:population, tz:timezone, ele:elevation|dem|null, alt?:Latin alternate names }`.
- The extra **`alt`** field (comma-joined Latin-script GeoNames alternate names) lets exonym search
  work (e.g. "Mecca" → Makkah, "Zurich" → Zürich) without per-city hardcoding; non-Latin scripts are
  dropped (the native form is already in `n`). `search()` matches over `n`, `a`, and `alt`.
- `reverse` uses the **request** lat/lon for method detection (not the matched city's centroid), so the
  Baghdad-radius rule is correct near the city edge. `admin1` is returned as the raw GeoNames code.

## Attribution

City data © GeoNames (CC-BY 4.0), `https://www.geonames.org/`. Optional search fallback via
Open-Meteo geocoding, `https://open-meteo.com/`.
