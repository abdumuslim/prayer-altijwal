# Architecture

System design for **prayer.altijwal.com** — a public, GPS-based Islamic prayer-times webapp.
Sibling of `D:\dev\home`, deployed on the same VPS, reusing home's `prayer-engine`. This is a
**design document** (no code exists yet); illustrative signatures/shapes are reference contracts.

Related: `DECISIONS.md` (the why), `PRAYER_ENGINE.md`, `PRAYER_TIMES_API.md`, `GEOCODING.md`,
`NOTIFICATIONS.md`, `FRONTEND.md`, `DEPLOYMENT.md`.

---

## 1. High-level shape

```
Browser (React 19 SPA)                         VPS container (Node 22 / Express 5)
─────────────────────                          ───────────────────────────────────
geolocation → lat/lon ──┐                       ┌─ /api/geo/reverse  → cities dataset (offline)
                        ├─ HTTPS via Traefik ──▶ ├─ /api/geo/search   → cities dataset (+ Open-Meteo fallback)
localStorage (loc,      │   (prayer.altijwal     ├─ /api/prayer-times → prayer-engine (astronomy-engine)
 method, lang, prefs)   │    .com, TLS)          ├─ /api/push/*       → web-push + Postgres
1s countdown tick ◀─────┘                        └─ static client build (SPA fallback)
                                                          │
                                                 push scheduler loop ─▶ web-push ─▶ browser SW
                                                          │
                                                 Postgres `prayer` db (push_subscriptions, push_log)
```

One container serves the API **and** the built SPA on internal port 8000; Traefik terminates TLS and
routes `Host(prayer.altijwal.com)` to it (`DEPLOYMENT.md`).

---

## 2. Request flow (core prayer times)

1. Client resolves a **location**: persisted choice → else `navigator.geolocation` → else city search
   → else IP/browser-tz default (`FRONTEND.md` fallback chain).
2. Client calls `GET /api/geo/reverse?lat&lon` once to turn coords into
   `{ city, country, tz, elevation, method }` (offline cities dataset). The **`tz` and `method`**
   come from here — not from the device.
3. Client calls `GET /api/prayer-times?lat&lon&tz&method&asr` → server runs the engine and returns a
   payload of **absolute UTC timestamps** plus pre-formatted display strings, `nextPrayer`,
   `hijriDate`, `nextEvent`, `tomorrowFajr` (`PRAYER_TIMES_API.md`).
4. Client renders, then **ticks a local `setInterval(1000)`** recomputing each countdown from
   `timestamp − Date.now()` and re-deriving `isNext`/`isPassed` — so the countdown is smooth and can
   never diverge from the server. Re-fetch on: location/method/asr change, local-midnight rollover,
   or tab refocus after staleness.

This is home's philosophy: **server emits instants, client ticks**.

---

## 3. The timezone model (the central correctness concern)

The engine returns **absolute UTC `Date`s**. A timezone is needed for exactly two things:

1. **Anchoring the civil day.** `calculatePrayerTimes(coords, date, { timezone })` uses
   `zonedMidnightUtc(date, tz)` to decide *which* calendar day to compute. This must be the
   **target location's** IANA tz.
2. **Formatting for display.** `date.toLocaleTimeString(locale, { timeZone })` and the Hijri
   `Intl.DateTimeFormat(..., { timeZone })` must use the **target location's** tz.

> ⚠️ **Never default to the device tz** (`Intl.DateTimeFormat().resolvedOptions().timeZone`). A user
> in London viewing Mecca's times needs `Asia/Riyadh`, not `Europe/London`. The `tz` is a **required**
> API parameter, sourced from location resolution (the cities dataset row / Open-Meteo result). This
> is the single biggest change from home, which silently assumed device-tz == `Asia/Baghdad`.

`isPassed` / `isNext` / `countdown` are pure epoch-ms arithmetic — timezone-independent — and copy
home's logic unchanged.

**DST safety.** "Tomorrow" must be re-anchored via `zonedMidnightUtc`, not computed as a naïve
`now + 24h` (which skips/repeats a civil day at DST transitions). The engine already does this for
its Sunnah calculations.

**High latitude.** Above ~48° the twilight angle can be unreachable in summer and the engine returns
`Invalid Date` with `highLatitudeRule: "None"`. The public app sets a sensible default
(`AngleBased`) so users never see NaN. See `PRAYER_ENGINE.md`.

---

## 4. Notifications scheduler model (summary)

Per-subscriber, per-timezone, restart-safe. Each subscription stores its own `lat/lon/tz/method/asr`
and reminder prefs. A backend loop (~every 30s) computes **each subscriber's** times in **their own
tz** and fires web-push at each prayer minus the chosen lead. Dedup is a **persistent** Postgres
ledger (`push_log`) gated by `INSERT ... ON CONFLICT DO NOTHING RETURNING`, so restarts and
overlapping ticks never double-send or miss. Full design + the two home weaknesses it fixes
(Baghdad-tz pinning, in-memory dedup) are in `NOTIFICATIONS.md`.

---

## 5. Planned directory layout (many small files)

Mirrors home's two-app layout so the Dockerfile/compose pattern transfers. **Not yet created** — this
is the target for implementation.

```
prayer/
├── docker-compose.yml · Dockerfile · .env.example · .dockerignore · README.md
├── docs/                      # this documentation set
├── server/
│   └── src/
│       ├── index.ts           # entry: pool → initDb → app → scheduler → listen(8000)
│       ├── app.ts             # express: json, static(SPA), router, SPA fallback
│       ├── config.ts          # env → Config, zod-validated at startup
│       ├── logger.ts          # pino
│       ├── prayer-engine/     # COPIED VERBATIM from home — never edited
│       ├── prayer/            # compute.ts, payload.ts, format.ts, hijri.ts, events.ts, method-detect.ts
│       ├── geo/               # cities-index.ts, reverse.ts, search.ts
│       ├── push/              # webpush.ts, scheduler.ts, routes.ts
│       ├── db/                # pool.ts, schema.ts, repositories/*
│       ├── validation/        # zod schemas at every boundary
│       └── router.ts
└── client/
    └── src/
        ├── i18n/              # strings.ar.ts, strings.en.ts, I18nProvider.tsx
        ├── lib/               # api.ts, storage.ts, geolocation.ts, push.ts
        ├── hooks/             # usePrayerTimes, useLocation, useSettings, usePushSubscription
        └── components/        # PrayerList/Card, NextPrayerCountdown, HijriDate, NextEvent,
                               #   LocationBar, CitySearch, SettingsPanel, NotificationsOptIn, LanguageToggle
```

Rationale: home's `routes.ts`/`collector.ts` grew into 700–2000-line monoliths; here payload, format,
hijri, geo, and push are deliberately split into focused <200-line modules (coding-style:
many-small-files, <800 lines/file).

---

## 6. Data & external dependencies

| Concern | Choice | Notes |
|---|---|---|
| Astronomy | `astronomy-engine` (server-only) | ~1 arcminute; same as home |
| Geocoding | bundled GeoNames `cities15000` (offline) + Open-Meteo fallback | no API key, no rate limit; `GEOCODING.md` |
| Hijri date | `Intl` `islamic-umalqura` | needs full ICU — `node:22-slim` has it (verify at boot) |
| Push | `web-push` + VAPID + Postgres | `NOTIFICATIONS.md` |
| DB | shared PG16 (`rag-postgres-1`), dedicated `prayer` database | bootstrapped at startup |

No secrets in code; validated at startup; see `OPERATIONS.md` / `DEPLOYMENT.md`.
