# Admin Dashboard

Operator surface at **https://prayer.altijwal.com/admin** — one password, one operator.

Related: `DECISIONS.md` (ADR-015 admin surface, ADR-016 telemetry), `DEPLOYMENT.md` (env + build),
`OPERATIONS.md` (the actual credentials, local-only), `QIBLA_MASJID_SPEC.md` §6d (the spend data it
displays), `PLAY_RELEASE.md` (Data Safety consequences of the telemetry).

> **Status:** P0 (auth + overview) built and committed. Later phases — masjid moderation, cost &
> push detail, logs, kill-switch, telemetry/audience, Play stats — land incrementally; each section
> below says what exists.

---

## 1. Why it is a separate bundle

`client/capacitor.config.ts` sets `webDir: "dist"`, so **everything in the SPA build is packaged into
the Android APK**. An admin route inside the SPA would ship operator code inside a distributable app.

So the dashboard is its own Vite application:

| | SPA | Admin |
|---|---|---|
| Source | `client/src/` | `client/admin/` |
| Config | `client/vite.config.ts` | `client/vite.admin.config.ts` |
| Output | `client/dist` → image `./static` | `client/dist-admin` → image `./static-admin` |
| Served at | `/` | `/admin` |
| In the APK | yes | **no** |
| Language | Arabic, RTL, 4 themes | English, LTR, one dark theme |

The admin config deliberately omits `reusedEngineResolver()`, so the prayer engine is *structurally*
unreachable from the dashboard rather than merely forbidden by a rule.

Build: `npm --prefix client run build:admin` (runs `tsc -p tsconfig.admin.json` first).
Dev: `npm --prefix client run dev:admin` → http://localhost:5174/admin/ (proxies `/api` to :8000).

---

## 2. Mount order in `server/src/app.ts` (load-bearing)

```
no-cache
  → express.json  (admin only)
  → ADMIN API ROUTER          ← before CORS
  → cors({ origin: true }) on /api
  → express.json
  → public API router
  → /api JSON-404
  → /admin static + /admin{/*splat} fallback   ← before the SPA fallback
  → SPA static
  → SPA history fallback
  → error handler
```

Two of these are silent failures if reordered, and both are pinned by `server/src/app.test.ts`:

1. **Admin API before `cors({ origin: true })`.** The public `/api` reflects any origin (the native
   Capacitor app fetches cross-origin from `https://localhost`). The admin router is mounted ahead of
   it and emits no CORS headers at all, so the admin API is same-origin only. It also **claims its
   whole subtree**, including `OPTIONS`, via a trailing `r.all("/api/admin{/*splat}")` — without that,
   an unmatched cross-origin preflight falls through to the permissive CORS below and gets approved.
2. **`/admin` before the SPA history fallback.** `app.get("/{*splat}")` answers every unmatched GET
   with the prayer-times shell; mounted first it would swallow every admin URL.

`/admin` also carries `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` and a CSP
pinned to self plus `frame-src https://www.google.com` (the Maps Embed preview).

---

## 3. Authentication

**Stateless.** No sessions table, no revocation list.

- **`ADMIN_PASSWORD_HASH`** — `scrypt:N:r:p:salt:hash`. The cost parameters travel inside the digest,
  so they can be raised later without invalidating existing hashes. Digests with absurd parameters
  (>64 MB working set) are rejected rather than allowed to wedge the process on every login.

  > ⚠️ **The separator is `:`, deliberately not the conventional PHC `$`.** This value lives in
  > `/opt/prayer/.env`, which Docker Compose loads through `env_file` — and **Compose interpolates
  > variables inside those values**. A `$`-separated digest arrives at the container with every
  > `$<field>` replaced by an empty string, silently truncated, and every login fails with no useful
  > error (hit in production 2026-07-26). Keep any new `.env` value free of `$`, or escape it as `$$`.
- **`ADMIN_SESSION_SECRET`** — HMAC key for the cookie. Absent ⇒ a random key per boot, which logs
  the operator out on every redeploy (warned at startup).
- **Cookie `padm`** = `base64url(payload).base64url(HMAC)` where payload is
  `{v, iat0, exp, pf}`. `pf` is a fingerprint of the password digest, so **changing the password
  invalidates every outstanding session** — the one revocation lever this needs.
  12 h idle (slid forward while in use), 7 d absolute from first login.
  `HttpOnly; SameSite=Strict; Path=/api/admin`, and `Secure` **only in production** — browsers refuse
  Secure cookies over `http://localhost`, which would make local development impossible to log into.
- Signatures are compared as **encoded strings**, not decoded bytes: base64url's final character
  carries unused padding bits, so distinct signature strings decode to identical bytes, and Buffer's
  decoder silently drops invalid characters.

**Throttling** (`admin/rate-limit.ts`) has two layers, because per-key alone bounds nothing:
`clientIpOf` trusts `cf-connecting-ip`/`x-forwarded-for`, which anyone reaching the origin IP
directly can rotate at will.

| Layer | Rule |
|---|---|
| Per key (IP /24 or /64) | 5 failures / 15 min → 15 min lock, doubling per repeat to 24 h max |
| Global | 50 failures / 15 min across **all** keys → 15 min lock on all logins |
| Escape hatch | a key that has logged in successfully is trusted for 30 days and bypasses the *global* lock (never its own) — otherwise a botnet could keep the operator locked out |

Password verification runs **async** (Node's threadpool). scrypt is deliberately ~80 ms and this
process also answers prayer-times for everyone; a burst of login attempts must not stall those. At
most 2 verifications run concurrently.

**CSRF:** every non-GET `/api/admin/*` request must carry `X-Admin-Request: 1`. `OPTIONS` is exempt so
unmatched preflights reach the catch-all 404. Combined with SameSite=Strict and the absence of CORS
headers, a cross-site write is impossible.

**Disabled by default.** No `ADMIN_PASSWORD_HASH` ⇒ the router is never built, every `/api/admin` path
falls through to the generic `/api` 404, and nothing advertises that the surface exists. This matches
the existing `GET /api/places/usage?token=` convention.

### Rotating the password

```bash
cd server && node scripts/hash-admin-password.mjs      # type the password on stdin
# paste ADMIN_PASSWORD_HASH=... into /opt/prayer/.env, then:
docker compose up -d
```
Every existing session dies automatically (the `pf` fingerprint changes).

---

## 4. Endpoints

All under `/api/admin`, all requiring a session except `POST /api/admin/session`. Errors are
`401 Unauthorized`, `403 Forbidden` (missing CSRF header), `429 Too many attempts` (+ `Retry-After`),
`404 Not found` (unknown path, or the whole tree when unconfigured).

| Method | Path | Purpose | Phase |
|---|---|---|---|
| POST | `/api/admin/session` | log in → `204` + cookie | P0 |
| GET | `/api/admin/session` | session probe | P0 |
| DELETE | `/api/admin/session` | log out | P0 |
| GET | `/api/admin/overview` | health, counts, scheduler, spend, audience | P0 |
| GET/PATCH | `/api/admin/masjids/*` | contribution moderation | P1 |
| GET | `/api/admin/places/*` | outcome stats, top spenders, cell demand | P2 |
| GET/DELETE | `/api/admin/push/*` | subscriber + delivery health | P2 |
| GET | `/api/admin/logs` | recent warnings/errors | P3 |
| GET/PUT | `/api/admin/settings` | kill-switch + spend cap | P3 |
| GET | `/api/admin/audit` | audit trail | P3 |
| GET | `/api/admin/audience` | anonymous usage breakdowns | P4 |
| GET | `/api/admin/play/stats` | Play Console metrics | P6 |

### Response rules (non-negotiable)

Every response is **field-whitelisted** — no `config` object, no `process.env`, no raw database row is
ever spread into a body. In particular:

- **Never return a full push `endpoint`** — it is a bearer-capable credential. Host only
  (`fcm.googleapis.com`) plus the numeric id.
- **Never return a full `client_id`** — first 8 characters and an ellipsis.
- **Round `push_subscriptions` coordinates to 2 dp** for display.

`embedKey` *is* returned: the Maps **Embed** key is browser-visible by design (Embed-API-restricted
and unmetered) and is already sent to every app user. It is never the Places key.

---

## 5. Audit trail

`admin_audit(id, at, actor_ip, action, target, details)` records every mutation, plus `session.login`
and `session.lockout`. `actor_ip` is a **prefix** (/24 or /64), never a full address.

Failed password attempts are deliberately **not** recorded per-attempt — that would let anyone on the
internet grow the table without limit. Only the moment a lockout begins is written.

Retention: 365 days, pruned by the daily job.

---

## 6. Tables owned by the dashboard

| Table | Holds | Retention |
|---|---|---|
| `usage_ping` | one row per install per day (anonymous) | 180 d |
| `app_settings` | runtime overrides for env-configured knobs | forever |
| `admin_audit` | mutation trail | 365 d |
| `push_stats` | durable push delivery rollup | 400 d |
| `play_stats` | cached Play Console metrics | forever |

All are added to the idempotent DDL in `server/src/db/schema.ts` (no migration framework — see the
dated comments there).

**`app_settings` reader contract:** every read falls back to the env value when the row, or the whole
database, is unavailable. A DB outage must never silently disable a feature.

---

## 7. Environment

See `.env.example` for the annotated list. Admin-relevant:

| Var | Effect if absent |
|---|---|
| `ADMIN_PASSWORD_HASH` | dashboard API disabled (404) |
| `ADMIN_SESSION_SECRET` | random per boot — logged out on every restart |
| `TELEMETRY_SALT` | audience ping accepted but stored nowhere |
| `TELEMETRY_RETENTION_DAYS` | 180 |
| `TELEMETRY_PRECISION_DEG` | 0.01 (~1.1 km) |
| `PLAY_SA_KEY_FILE` / `PLAY_REPORTS_BUCKET` | Play page reports "not configured" |

---

## 8. Anonymous audience telemetry

Full rationale in `DECISIONS.md` ADR-016. The essentials:

- The client rounds coordinates to **0.01° (~1.1 km) before sending**; the server clamps again, so a
  modified client cannot cause finer data to be stored.
- The stored key is `HMAC(salt, day || '|' || clientId)`. **The day is inside the message**, so the
  same install hashes differently every day and stored rows cannot be linked across days. The raw
  client id is never stored.
- **Consequence, which every reader must respect:** cross-day uniques — true WAU/MAU — are
  *uncomputable*. The API and UI report `avg7d`/`avg30d` = the **average of daily-active counts**,
  labelled "avg daily actives". Never present a number as unique users.
- Changing `TELEMETRY_PRECISION_DEG` downward, or storing the client id, is a **Play Data Safety +
  privacy-policy change**, not a config tweak.
