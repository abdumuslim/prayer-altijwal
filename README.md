# prayer.altijwal.com

A public, **GPS-based Islamic prayer-times** webapp. Detects your location in the browser, computes
accurate prayer times for it, shows a live countdown to the next prayer, the Hijri date and next
Islamic event, lets you search any city, and can send prayer reminders. Bilingual **Arabic/English**
(Arabic default, RTL).

> **Status: implemented (MVP).** Backend (Express 5), frontend (React 19), engine, geocoding, and
> web-push are built and deployed. See `docs/` for the design and `DECISIONS.md` for the choices.

---

## What it does

- **Prayer times by GPS** — today's Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha for your exact location.
- **Live next-prayer countdown**, ticking locally and never diverging from the server.
- **Hijri date + next Islamic event.**
- **Location-aware method** — auto-picks the official calculation method for your country, with a
  manual picker (13 methods + Asr Standard/Hanafi) you can override.
- **City search / manual location** — view any city's times.
- **Prayer reminders** — opt-in web-push notifications ahead of each prayer.

Future (designed, not in the first version): Qibla compass, monthly times table.

---

## How it's built

| Layer | Tech |
|---|---|
| Calculation | `prayer-engine` (reused verbatim from the `home` project) on `astronomy-engine`, ~1 arcminute accuracy |
| Backend | Node 22 · Express 5 · TypeScript — serves the API and the SPA on one port |
| Frontend | React 19 · Vite 7 · Tailwind 4 — bilingual, RTL-aware, installable PWA |
| Geocoding | bundled GeoNames `cities15000` (offline) + optional Open-Meteo fallback |
| Notifications | Web Push (VAPID) + PostgreSQL (dedicated `prayer` db) + a restart-safe scheduler |
| Hosting | Docker + Traefik on the shared VPS, served at `prayer.altijwal.com` |

The prayer engine is **location-agnostic** and returns absolute UTC instants; the app supplies each
location's IANA timezone and the appropriate method. See `docs/ARCHITECTURE.md`.

---

## Documentation (tiered — "PC storage levels")

Most-needed info is compressed into the always-loaded routers; full detail is one hop away.

- **Tier 1 (always loaded):** `AGENTS.md` (committed router + identity + routing table),
  `CLAUDE.md` (local-only operating notes).
- **Tier 2 (session memory):** `C:\Users\Abdu\.claude\projects\D--dev-prayer\memory\` — working-style
  feedback, preferences, and a VPS/credentials hot-copy (no architecture knowledge).
- **Tier 3 (this folder, on demand):**
  - [`docs/DECISIONS.md`](docs/DECISIONS.md) — the load-bearing choices + rationale
  - [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system, timezone, and scheduler models
  - [`docs/PRAYER_ENGINE.md`](docs/PRAYER_ENGINE.md) — the reused engine, methods, BaghdadYMA nuance
  - [`docs/PRAYER_TIMES_API.md`](docs/PRAYER_TIMES_API.md) — HTTP API contract
  - [`docs/GEOCODING.md`](docs/GEOCODING.md) — location resolution + method detection
  - [`docs/NOTIFICATIONS.md`](docs/NOTIFICATIONS.md) — web-push design
  - [`docs/FRONTEND.md`](docs/FRONTEND.md) — components, hooks, i18n/RTL, PWA
  - [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — Docker, Traefik, deploy steps
  - `docs/OPERATIONS.md` — **local-only/gitignored**: VPS access + secrets

---

## Development

```bash
# Frontend dev (proxies /api/* to the local server on :8000)
cd client && npm install && npm run dev

# Server: install, type-check/build, run, test
cd server && npm install
cd server && npm run build         # tsc (Node16)
cd server && npm start             # node dist/index.js  (or: npm run dev for tsx watch)
cd server && npm test              # vitest (engine regression + wrappers + geo + scheduler)

# Regenerate the offline cities dataset (server/data/cities15000.json)
cd server && npm run build:cities
```

The server is stateless without `DATABASE_URL`/VAPID (public prayer-times + geo still work); set
`NODE_ENV=production` to require the DB + VAPID secrets at startup. Build a production image with
`docker build -t prayer .`; deploy steps are in `docs/DEPLOYMENT.md`.

---

## Attribution

City data © [GeoNames](https://www.geonames.org/) (CC-BY 4.0). Optional geocoding fallback via
[Open-Meteo](https://open-meteo.com/). Astronomy via
[astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT).
