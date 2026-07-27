---
type: Reference
title: 'HTTP API (contract)'
description: 'The JSON API served by the Node/Express backend. This is a reference contract for the design — no code exists yet. Generalizes home''s Baghdad-pinned /api/prayer-times to arbitrary location + timezone + method. All…'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# HTTP API (contract)

The JSON API served by the Node/Express backend. This is a **reference contract** for the design —
no code exists yet. Generalizes home's Baghdad-pinned `/api/prayer-times` to arbitrary location +
timezone + method. All endpoints are **public** (no auth) except where noted.

Base: `https://prayer.altijwal.com`

Related: `ARCHITECTURE.md` (tz model), `GEOCODING.md` (geo endpoints), `NOTIFICATIONS.md` (push).

---

## GET /api/prayer-times

```
GET /api/prayer-times?lat={n}&lon={n}&tz={IANA}&method={name}&asr={Standard|Hanafi}&date={YYYY-MM-DD}&elevation={m}&lang={ar|en}
```

| Param | Req | Default | Notes |
|---|---|---|---|
| `lat` | ✅ | — | [-90, 90] |
| `lon` | ✅ | — | [-180, 180] |
| `tz` | ✅ | — | IANA tz of the **target location** (not the device). Validated. |
| `method` | — | resolved from country, else `MWL` | one of the 13 preset keys |
| `asr` | — | per method (`Standard`) | `Standard` \| `Hanafi` |
| `date` | — | today in `tz` | `YYYY-MM-DD` |
| `elevation` | — | dataset/method value | metres |
| `lang` | — | `ar` | affects labels + Hijri formatting locale |

### Response

```jsonc
{
  "location": { "city": "Mecca", "country": "SA", "tz": "Asia/Riyadh", "lat": 21.42, "lon": 39.83, "elevation": 277 },
  "method":   { "key": "UmmAlQura", "label": "Umm al-Qura, Makkah", "asr": "Standard" },
  "date": "2026-06-19",
  "prayers": [
    { "name": "fajr",    "label": "Fajr",    "time": "4:18 AM",  "timestamp": 1789000000000, "isPassed": true,  "isNext": false, "countdown": null },
    { "name": "sunrise", "label": "Sunrise", "time": "5:42 AM",  "timestamp": 1789005000000, "isPassed": true,  "isNext": false, "countdown": null },
    { "name": "dhuhr",   "label": "Dhuhr",   "time": "12:20 PM", "timestamp": 1789028400000, "isPassed": false, "isNext": true,  "countdown": "2h 5m" },
    { "name": "asr",     "label": "Asr",     "time": "3:42 PM",  "timestamp": 1789040520000, "isPassed": false, "isNext": false, "countdown": "5h 27m" },
    { "name": "maghrib", "label": "Maghrib", "time": "6:58 PM",  "timestamp": 1789052280000, "isPassed": false, "isNext": false, "countdown": "8h 43m" },
    { "name": "isha",    "label": "Isha",    "time": "8:28 PM",  "timestamp": 1789057680000, "isPassed": false, "isNext": false, "countdown": "10h 13m" }
  ],
  "nextPrayer": { "name": "dhuhr", "label": "Dhuhr", "time": "12:20 PM", "timestamp": 1789028400000, "countdown": "2h 5m" },
  "hijriDate": "Dhul-Hijjah 4, 1447 AH",
  "nextEvent": { "name": "Day of Arafah", "isToday": false, "daysLeft": 5 },
  "tomorrowFajr": 1789086600000,
  "yesterdayIsha": 1788958320000,
  "duhaWindow":  { "start": 1789006500000, "end": 1789027500000 },
  "qiyamWindow": { "start": 1788980000000, "end": 1789000000000 }
}
```

**Field semantics** (same as home for the `prayers[]`/`nextPrayer`/etc. — byte-compatible so the
client hook generalizes with minimal change):

| Field | Meaning |
|---|---|
| `location`, `method` | **New vs home** — echo what was computed. `method` is **not surfaced in the UI** any more (the picker was removed — `DECISIONS.md` ADR-002/003); it's still returned for display logic. `location` drives the city/country shown. |
| `prayers[].timestamp` | epoch ms (UTC) — **drives the client's live local countdown** |
| `prayers[].time` | display string formatted in `location.tz` (and `lang` locale) |
| `prayers[].isPassed` / `isNext` | epoch-ms arithmetic vs server `now`; client re-derives locally each tick |
| `prayers[].countdown` | `"2h 5m"` / `"45m 12s"` / `"30s"`, or `null` if passed |
| `nextPrayer` | next upcoming; `label` becomes `"Fajr (tomorrow)"` once all today's have passed |
| `hijriDate` | Umm al-Qura calendar via `Intl`, formatted in `location.tz` |
| `nextEvent` | next of the 10 tracked Islamic events (`isToday`, `daysLeft`) |
| `tomorrowFajr` | epoch ms of tomorrow's Fajr — lets the client count past today's Isha |
| `yesterdayIsha` | epoch ms of yesterday's Isha — anchors the pre-Fajr countdown **ring** interval (Isha→Fajr across midnight) so it depletes instead of sitting full. Both wraparound anchors are computed from today's solar noon ±24 h (DST-safe). |
| `duhaWindow` | `{ start, end }` epoch ms (or `null`) — the forenoon Duha window: **sunrise+15 min → dhuhr−15 min**. The server returns the **soonest window whose `end > now`** across today/tomorrow, so the client just compares `now` to `start`/`end` (`now < start` → upcoming; `start ≤ now < end` → active). Uses the engine's `duhaWindow()` helper on the raw formula times (`null` at high latitude when sunrise is absent). |
| `qiyamWindow` | `{ start, end }` epoch ms (or `null`) — the **last third of the night** (qiyam/tahajjud): `maghrib + ⅔·(nextFajr−maghrib) → nextFajr`. Soonest window with `end > now` across last-night (`[yesterday.maghrib→today.fajr]`, covers the pre-Fajr case) and tonight (`end ≈ tomorrowFajr`). Engine `nightThird(…, "last")`; `null` when maghrib/sunset is absent. |

**Tracked Islamic events** (Hijri): Islamic New Year (1 Muharram), Ashura (10 Muharram), Mawlid
(12 Rabiʿ I), Isra & Miʿraj (27 Rajab), Change of Qibla (15 Shaʿban), Ramadan (1 Ramadan), Laylat
al-Qadr (27 Ramadan), Eid al-Fitr (1 Shawwal), Arafah (9 Dhul-Hijjah), Eid al-Adha (10 Dhul-Hijjah).

**Errors.** `400` with `{ error }` on invalid params (zod-validated at the boundary): out-of-range
lat/lon, unknown `tz`/`method`/`asr`, malformed `date`.

---

## Geo endpoints (detail in `GEOCODING.md`)

```
GET /api/geo/reverse?lat={n}&lon={n}
  → { city, cityAr, country, admin1, tz, elevation, method }   // nearest city; method = detected default

GET /api/geo/search?q={text}&lang={ar|en}
  → { results: [ { name, nameAr, country, admin1, tz, lat, lon, elevation, population } ] }   // ranked, top ~8

GET /api/geo/governorates?country={ISO-2}
  → { governorates: [ { name, nameAr, country, admin1, tz, lat, lon, elevation, population } ] }   // one capital per admin-1

GET /api/geo/declination?lat={n}&lon={n}
  → { declinationDeg }   // magnetic declination, +E of true north (WMM-2025 via `geomagnetism`)
```

`cityAr`/`nameAr` are the Arabic-script names (or `null`). `governorates` is the quick-pick that
replaced the manual method override (most-populous city per admin-1 division). Detail in `GEOCODING.md`.
`declination` feeds the WEB qibla-compass paths only (the native app uses Android's built-in
`GeomagneticField`); the client caches it per ~10 km grid in localStorage — stale beats none
(`docs/QIBLA_MASJID_SPEC.md` §5c). Tested against NOAA's official WMM-2025 test vectors.
**Maintenance:** the `geomagnetism` npm package (v0.2.0) bundles the WMM-2025 coefficients, valid
**into 2029** (`allowOutOfBoundsModel:true` degrades gracefully past the window — declination
drifts only ~0.1°/yr). When WMM-2030 lands, bump the package (or vendor the new `.COF`); a stale
model is a fraction-of-a-degree error, never a break.

---

## Places endpoints (nearest masjid — `QIBLA_MASJID_SPEC.md` §6a)

```
GET /api/places/masjids?lat={n}&lon={n}
  → { enabled: false, masjids: [] }                    // no GOOGLE_MAPS_API_KEY configured server-side
  → { enabled: true,  masjids: [ { id, name, lat, lon, address } ] }   // ≤10, distance-ranked, 5 km circle
  → { enabled: true,  masjids: [], degraded: true }    // upstream failure/timeout — NOT cached, client shows error
```

Server-side proxy over Google Places API (New) `places:searchNearby` (`includedTypes: ["mosque"]`,
`languageCode: ar`, 5 s timeout, minimal field mask) — **the key never reaches the client**.
Responses are cached in-memory per ~300 m grid cell (TTL 24 h, LRU-capped 500 entries) to bound the
paid-SKU spend. Invalid lat/lon → 400. The client hides the whole section when `enabled: false`.

---

## Push endpoints (detail in `NOTIFICATIONS.md`)

```
GET  /api/push/vapid-key            → { publicKey }
POST /api/push/subscribe            ← { subscription, lat, lon, tz, country?, method?, asr?, lang }   // prayers/leadMinutes now optional (reminders live in alert rules)
POST /api/push/unsubscribe          ← { endpoint }
POST /api/push/prefs                ← { endpoint, prayers?[], leadMinutes?[], method?, asr?, lang? }   // update subscription prefs
```

**Reminder rules — multiple independent alerts per device** (CRUD; ownership scoped to the
`endpoint`):

```
GET    /api/push/alerts?endpoint={url}     → { alerts: AlertRule[] }
POST   /api/push/alerts                     ← AlertRuleBody             → 201 { alert: AlertRule }
PUT    /api/push/alerts/:id                 ← AlertRuleBody             → { alert } | 404
DELETE /api/push/alerts/:id?endpoint={url}                              → { ok: true }
```

```jsonc
// AlertRuleBody (request)            // AlertRule (response)
{ "endpoint": "https://…",           { "id": 7,
  "timing": "before",                  "endpoint": "https://…",
  "minutes": 10,                       "timing": "before",
  "prayers": ["fajr","dhuhr",          "minutes": 10,
              "asr","maghrib","isha"]  "prayers": ["fajr","dhuhr","asr","maghrib","isha"] }
}
// timing ∈ {"at_time","before","after"}; minutes (1–180) is REQUIRED when timing="before"|"after",
// else null/ignored.
// prayers ∈ the AlertTarget enum: the five fard PLUS "duha", "qiyam", "adhkar_morning",
// "adhkar_evening" (sunnah/adhkar anchors — see NOTIFICATIONS.md §4). Kept as a plain TEXT[] in the
// DB; the zod AlertTarget enum is the only gate. Legacy subscribe/prefs `prayers` stay fard-only.
```

---

## GET /api/health

```
GET /api/health  → { ok: true, db: "up" }     // DB connectivity probe; used by the Docker healthcheck
```

## As-built notes (MVP)

- `GET /api/prayer-times` also accepts **`country`** (ISO-2) and **`city`** query params: `country`
  drives method auto-detection when `method` is omitted (for IQ → the calibrated Iraqi profile
  country-wide; `DECISIONS.md` ADR-002, reversed), and both are echoed back in `location`. When
  `method` is given it wins (auto=false). The UI no longer sends a `method` (the picker was removed),
  so detection is the live path.
- The response adds **`now`** (server epoch ms, for client clock-sync), **`lang`**, and on `method`:
  **`auto`** (was it auto-detected) and **`baghdadCalibrated`** (true for **all of Iraq** — enables the
  per-governorate Waqf calibration + the exact-data override; see `PRAYER_ENGINE.md` §4). `nextPrayer`
  carries a **`tomorrow`** boolean; `nextEvent` carries a stable **`key`** alongside the localized `name`.
- `db` health is `"up" | "down" | "disabled"` ("disabled" = no `DATABASE_URL`, stateless mode).
- Push endpoints (`/api/push/*`) return 503 when push isn't configured (no VAPID/DB).
- **CORS** is enabled on `/api/*` (`cors`, origin-reflecting) so the native (Capacitor) app can call
  the geo endpoints from its `https://localhost` origin (2026-07-11). The API is public/no-auth, so
  this exposes nothing new; the same-origin SPA is unaffected. See `NATIVE_ALARM_SPEC.md` §3a.
