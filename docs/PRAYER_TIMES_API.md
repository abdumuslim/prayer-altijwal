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
  "tomorrowFajr": 1789086600000
}
```

**Field semantics** (same as home for the `prayers[]`/`nextPrayer`/etc. — byte-compatible so the
client hook generalizes with minimal change):

| Field | Meaning |
|---|---|
| `location`, `method` | **New vs home** — echo what was computed so the UI can show "what am I looking at" + confirm auto-detection |
| `prayers[].timestamp` | epoch ms (UTC) — **drives the client's live local countdown** |
| `prayers[].time` | display string formatted in `location.tz` (and `lang` locale) |
| `prayers[].isPassed` / `isNext` | epoch-ms arithmetic vs server `now`; client re-derives locally each tick |
| `prayers[].countdown` | `"2h 5m"` / `"45m 12s"` / `"30s"`, or `null` if passed |
| `nextPrayer` | next upcoming; `label` becomes `"Fajr (tomorrow)"` once all today's have passed |
| `hijriDate` | Umm al-Qura calendar via `Intl`, formatted in `location.tz` |
| `nextEvent` | next of the 10 tracked Islamic events (`isToday`, `daysLeft`) |
| `tomorrowFajr` | epoch ms of tomorrow's Fajr — lets the client count past today's Isha |

**Tracked Islamic events** (Hijri): Islamic New Year (1 Muharram), Ashura (10 Muharram), Mawlid
(12 Rabiʿ I), Isra & Miʿraj (27 Rajab), Change of Qibla (15 Shaʿban), Ramadan (1 Ramadan), Laylat
al-Qadr (27 Ramadan), Eid al-Fitr (1 Shawwal), Arafah (9 Dhul-Hijjah), Eid al-Adha (10 Dhul-Hijjah).

**Errors.** `400` with `{ error }` on invalid params (zod-validated at the boundary): out-of-range
lat/lon, unknown `tz`/`method`/`asr`, malformed `date`.

---

## Geo endpoints (detail in `GEOCODING.md`)

```
GET /api/geo/reverse?lat={n}&lon={n}
  → { city, country, admin1, tz, elevation, method }      // nearest city; method = detected default

GET /api/geo/search?q={text}&lang={ar|en}
  → { results: [ { name, country, admin1, tz, lat, lon, elevation, population } ] }   // ranked, top ~8
```

---

## Push endpoints (detail in `NOTIFICATIONS.md`)

```
GET  /api/push/vapid-key            → { publicKey }
POST /api/push/subscribe            ← { subscription, lat, lon, tz, country, method, asr, prayers[], leadMinutes[], lang }
POST /api/push/unsubscribe          ← { endpoint }
POST /api/push/prefs                ← { endpoint, prayers?[], leadMinutes?[], method?, asr? }   // update prefs
```

---

## GET /api/health

```
GET /api/health  → { ok: true, db: "up" }     // DB connectivity probe; used by the Docker healthcheck
```

## As-built notes (MVP)

- `GET /api/prayer-times` also accepts **`country`** (ISO-2) and **`city`** query params: `country`
  drives method auto-detection (with the Baghdad-radius rule) when `method` is omitted, and both are
  echoed back in `location`. When `method` is given it wins (auto=false).
- The response adds **`now`** (server epoch ms, for client clock-sync), **`lang`**, and on `method`:
  **`auto`** (was it auto-detected) and **`baghdadCalibrated`** (true only inside Baghdad's radius, i.e.
  the +5/+3/+2 offsets are active). `nextPrayer` carries a **`tomorrow`** boolean; `nextEvent` carries a
  stable **`key`** alongside the localized `name`.
- `db` health is `"up" | "down" | "disabled"` ("disabled" = no `DATABASE_URL`, stateless mode).
- Push endpoints (`/api/push/*`) return 503 when push isn't configured (no VAPID/DB).
