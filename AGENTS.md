# AGENTS.md — Prayer Times (prayer.altijwal.com)

Always-loaded (Tier-1) guide for AI agents. This file is deliberately small: deep knowledge lives in
**Tier-3 topic docs** under `docs/` that you MUST read on demand (see the routing table). Do not
guess details that live in a topic doc — read the doc.

> **Status: implemented (MVP) and deployed** at https://prayer.altijwal.com. Code lives in `server/`
> (Express 5) and `client/` (React 19); the layout follows `docs/ARCHITECTURE.md`. Tests are green
> (`npm --prefix server test`) and the container runs on the shared VPS behind Traefik (`prayer.*`).

## What this is

Public, **location-based Islamic prayer-times** webapp at **https://prayer.altijwal.com**. Opens on a
**Baghdad default** (Iraq-centric audience; no auto-GPS prompt); the user switches location via GPS
(opt-in, in the search panel), city search, or the governorate quick-pick. The server computes prayer
times for the resolved location and returns a live-countdown payload. Sibling of the `home` dashboard
(`D:\dev\home`): deployed on the **same VPS** (Docker + Traefik), **reusing home's location-agnostic
`prayer-engine` verbatim**. UI is bilingual **Arabic/English** (Arabic the hard default, RTL; numerals
always Latin). Backend: Node 22 / Express 5 / TypeScript. Frontend: React 19 / Vite 7 / Tailwind 4.
Storage: a dedicated `prayer` PostgreSQL database (push subscriptions + reminder rules).

```
Browser (GPS) → Cloudflare → Traefik (VPS) → prayer container (port 8000) → PostgreSQL (db=prayer)
```

## The 4 decisions (one line each — full rationale in `docs/DECISIONS.md`)

1. **Backend API** architecture — server reuses the engine, client fetches JSON + ticks the countdown.
2. **Method auto-detected by location** (country → official method); the calibrated Iraqi
   (`BaghdadYMA`) profile applies to **all of Iraq**. Method/madhab are **not surfaced** in the UI.
3. **MVP** = core times + countdown + Hijri/events **+ web-push reminders + city search**, plus the
   hero's **Duha + Qiyam (last-third) satellites** and a **per-prayer iqama countdown bar** (Qibla &
   monthly table deferred). Reminders are **multiple independent alert rules** (per-prayer × timing),
   ported from home (`docs/NOTIFICATIONS.md`). Hero aids detailed in `docs/FRONTEND.md` (§5) +
   `docs/PRAYER_TIMES_API.md` (`duhaWindow`/`qiyamWindow`). **+ gamified worship tracker**
   (2026-07-03): fard check-in (masjid +3 / home +2 / missed −1) + rawatib & adhkar corner rings +
   tap-to-count adhkar reader + score/streak stats — client-only in `prayer.worship.v1`
   (`docs/FRONTEND.md` §8, `docs/DECISIONS.md` ADR-006). **All worship features (Duha, Qiyam,
   rawatib, adhkar, record+points/history) are opt-in and OFF by default** — five Settings switches,
   persisted as `features` on `prayer.app.v1` (2026-07-04, ADR-007).
4. **Bilingual AR/EN**, Arabic default, RTL-aware.

## Routing table — read the doc BEFORE working on the topic

| If your task touches… | You MUST first read |
|---|---|
| The choices behind everything (architecture, method policy, scope, i18n) | `docs/DECISIONS.md` |
| System design, request flow, **timezone model**, scheduler model, planned file layout | `docs/ARCHITECTURE.md` |
| The reused engine: `calculatePrayerTimes`, 13 methods, **nationwide Iraqi (BaghdadYMA) calibration**, high-lat | `docs/PRAYER_ENGINE.md` |
| HTTP API contract: `/api/prayer-times`, geo + push endpoints, response shapes | `docs/PRAYER_TIMES_API.md` |
| Location resolution: GeoNames cities dataset, reverse/forward, country→method detection | `docs/GEOCODING.md` |
| Web-push: service worker, VAPID, DB schema, **restart-safe per-tz scheduler**, iOS PWA caveat | `docs/NOTIFICATIONS.md` |
| Frontend: components, hooks, geolocation flow, i18n/RTL, localStorage, PWA | `docs/FRONTEND.md` |
| Docker, Traefik labels, VPS layout, deploy steps, DB bootstrap, VAPID | `docs/DEPLOYMENT.md` |
| SSH/VPS access, credentials, secrets, routine ops | `docs/OPERATIONS.md` ⚠️ local-only (gitignored); if absent, ask the user |

Multiple topics → read multiple docs; they cross-link. User preferences and working-style feedback
live in Claude's Tier-2 memory (see `CLAUDE.md`), not in this repo.

## Commands

```bash
cd client && npm run dev        # frontend dev (proxies /api/* to the server)
cd server && npx tsc --noEmit   # server type-check (works)
cd client && npm run build      # client typecheck + build — USE THIS. Bare `tsc --noEmit` in
                                # client/ is a NO-OP (solution-style config); only `tsc -b`
                                # (run by `npm run build`) catches type errors → else the Docker
                                # build fails on deploy. See [[build_client_typecheck_gotcha]].
cd server && npm test           # server tests (vitest)
cd server && npm run build:cities   # regenerate the bundled GeoNames dataset (n/a/alt/nar/etc.)
```

Deployment: tarball → scp → `docker compose up -d --build` on the VPS — exact steps in
`docs/DEPLOYMENT.md` (sensitive specifics in `docs/OPERATIONS.md`).

## Hard rules

1. **Never commit secrets.** `CLAUDE.md` and `docs/OPERATIONS.md` are gitignored (credentials/VPS) —
   never copy their contents into committed files, never `git add -f` them. Secrets live only in the
   VPS `.env`.
2. **Reuse the engine verbatim; never edit `server/src/prayer-engine/`.** Calibrate/extend via
   `config` in *our* wrapper modules. Re-copy from home if it improves upstream (`docs/PRAYER_ENGINE.md`).
3. **`astronomy-engine` is server-only** (loaded via `createRequire`) — never import `prayer-engine/`
   into the client bundle.
4. **All engine times are UTC; the `tz` is the *target location's* IANA tz, never the device tz.**
   This is the central correctness rule (`docs/ARCHITECTURE.md` §3).
5. **The Iraqi `BaghdadYMA` profile applies to all of Iraq** (cc=IQ), not just Baghdad, with a
   **per-governorate calibration** (`prayer/iraq-calibration.ts` overrides the engine's flat
   `+5/+3/+2` via `config`) fit to the official ديوان الوقف السني table — ~83% exact, 99.4% within ±1
   — plus an **exact-data override** (`waqf-exact.json`) that serves digitized poster dates verbatim
   (literal 0-min). Calibration data is **generated** by `scripts/build-waqf-calibration.ts`, never
   hand-edited (`docs/DECISIONS.md` ADR-002, reversed; regression in `iraq-governorates.test.ts`).
6. **Traefik router names must be `prayer.*`** (never `home.*`) — a duplicate name on the shared
   Traefik silently breaks routing (`docs/DEPLOYMENT.md`).
7. **VPS clock is UTC** — never use server-local wall-clock for prayer logic; always pass an explicit
   IANA tz (engine + scheduler already do).
8. **Default a high-latitude rule** (`AngleBased`) so users above ~48° never get `Invalid Date`.
9. **Validate at boundaries** (zod) and **fail fast at startup** if a required secret is missing.

## Conventions

- Conventional commits (`feat:`/`fix:`/`docs:`…). Vitest for server tests; port the engine's
  regression test and keep it green (proves the copy is faithful). Target 80% coverage.
- Many small files (<800 lines, focused modules) — see the planned layout in `docs/ARCHITECTURE.md`.
- Structured logging (pino `childLogger("component")`) — no bare `console.log` in server code.
- Documentation tiers: update the relevant `docs/*.md` when behavior changes; keep this file and
  `CLAUDE.md` small (routing + rules only).
