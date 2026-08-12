---
type: Reference
title: 'Admin Dashboard'
description: 'Operator surface at https://prayer.altijwal.com/admin — one password, one operator.'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# Admin Dashboard

Operator surface at **https://prayer.altijwal.com/admin** — one password, one operator.

Related: `DECISIONS.md` (ADR-015 admin surface, ADR-016 telemetry), `DEPLOYMENT.md` (env + build),
`OPERATIONS.md` (the actual credentials, local-only), `QIBLA_MASJID_SPEC.md` §6d (the spend data it
displays), `PLAY_RELEASE.md` (Data Safety consequences of the telemetry).

> **Status (2026-07-26): BUILT AND LIVE** at https://prayer.altijwal.com/admin — overview, masjid
> moderation, cost, push health, audience, logs, settings/kill-switch and the audit trail. The Play
> Console stats page is the one remaining piece; it needs a Google service account the owner has to
> grant (§9).

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
pinned to self, plus exactly two third-party allowances:

| Directive | Host | Why |
|---|---|---|
| `frame-src` | `https://www.google.com` | Maps Embed preview of a contributed masjid |
| `img-src` | `https://tile.openstreetmap.org` (+ `*.tile.`) | Leaflet basemap tiles on the Cost and Audience maps (2026-07-26) |

**`script-src` and `connect-src` stay `'self'`.** Leaflet is bundled, not CDN-loaded, and tiles are
plain `<img>` loads — so the dashboard still cannot execute third-party code or open an XHR to any
outside origin. Verified in the built bundle: the OSM host appears only as a tile-URL string and
`dist-admin/index.html` references no external origin at all.

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
| GET | `/api/admin/masjids/contributions?status=` | moderation queue + counts, with duplicate flags | ✅ |
| PATCH | `/api/admin/masjids/contributions/:id` | approve / reject / correct name+coords | ✅ |
| GET | `/api/admin/masjids/summary` | counts by status, resident vs community | ✅ |
| GET | `/api/admin/places/stats?days=` | daily + hourly outcome mix, governor plan | ✅ |
| GET | `/api/admin/places/top-clients?days=` | what each anonymous client cost | ✅ |
| GET | `/api/admin/places/demand?days=` | ~1 km demand cells | ✅ |
| GET | `/api/admin/push/summary?days=` | subscribers, rules, delivery history | ✅ |
| DELETE | `/api/admin/push/subscriptions/:id` | remove a subscriber (cascades) | ✅ |
| GET | `/api/admin/logs?level=&component=` | recent warnings/errors from the ring buffer | ✅ |
| GET/PUT | `/api/admin/settings` | kill-switch + spend cap, with per-value source | ✅ |
| DELETE | `/api/admin/settings/:name` | drop an override, back to the env value | ✅ |
| GET | `/api/admin/audit?limit=` | audit trail | ✅ |
| GET | `/api/admin/audience?days=` | anonymous usage breakdowns | ✅ |
| GET | `/api/admin/play/stats` | Play Console metrics | pending (§9) |

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

**Known, accepted mismatch — 0.01° is technically "precise location" (owner's call, 2026-07-26).**
Play's Data Safety definitions draw the line at **3 km²**: *approximate* is an area **≥ 3 km²**,
*precise* is **< 3 km²**. At Baghdad's latitude `0.01°` is 1.11 km × 0.93 km ≈ **1.03 km²**, i.e.
under the line — so the cell we retain for 180 days is, by Play's literal definition, **precise**
location, while the form declares the retained data as *approximate* (and declares precise location
as *ephemeral*, which the retained cell is not).

**Decision: accept it, do not change.** Nothing functionally breaks, no user is materially misled
(the listing already says location is collected and used for functionality + analytics), and the
sensitivity is genuinely low because the daily-rotating HMAC makes the rows **unlinkable across
days** — a ~1 km cell attached to a key that dies every midnight is not a movement trail. Google
cannot observe server-side retention, so detection risk is negligible; this is a truthfulness gap,
not an enforcement one.

**If it ever needs closing, it is one env var — no code change.** The server already clamps stored
precision independently of the client, so `TELEMETRY_PRECISION_DEG=0.02` in `/opt/prayer/.env`
+ `docker compose up -d` makes the retained cell ≈ 4.1 km² and the "approximate" declaration true.
Caveat if you do: a **fixed** degree grid shrinks in area with latitude — `0.02°` is ≥3 km² only up
to about 55°N, which covers the Iraq-centric audience (29–37°N ⇒ 3.9–4.1 km²) but not high-latitude
users. The latitude-proof version is a `0.02°` lat step with the lon step widened by `1/cos(lat)`,
giving a constant ~4 km² worldwide; that one *is* a code change.


---

## 9. Pages

| Page | What it answers | Backed by |
|---|---|---|
| **Overview** | Is everything healthy right now? | live process + one counts query |
| **Masjids** | What is waiting for review, and is it a duplicate? | `masjid_contributions` + `isSameMasjid` against the resident index |
| **Cost** | What is Google costing me, who is spending it, and where? | `places_stats`, `places_usage`, `places_cell_demand` — all pre-existing |
| ↳ *both maps* | Where is demand / where is the app used? | `components/TileMap.tsx` — Leaflet + OSM basemap (see below) |
| **Push** | Are reminders actually being delivered? | `push_subscriptions`, `prayer_alert_rules`, `push_stats` |
| **Audience** | How many people use the app, where, on what version? | `usage_ping` |
| **Logs** | What just broke? | in-memory ring buffer (resets on restart) |
| **Settings** | Turn the paid feature off / lower the cap, and see who changed what | `app_settings` + `admin_audit` |
| **Play** | Installs, crashes, ratings | *not built — access is now granted, but Play has no data to serve yet (below)* |

### Play Console stats — access GRANTED, but ⏸ BLOCKED ON DATA EXISTING

Installs, uninstalls, active devices and ratings are **not** in the Play Developer Reporting API;
they come from the **bulk report CSVs** in the Cloud Storage bucket linked to the developer account.
Crash/ANR rates do come from the Reporting API.

**Done 2026-07-26 (steps 1–2 complete):**

- **Play Developer Reporting API enabled** on GCP project `al-tijwal-483313`
  (`playdeveloperreporting.googleapis.com`, Status: Enabled).
- **Service account created:** `prayer-play-stats@al-tijwal-483313.iam.gserviceaccount.com`
  (no roles in GCP IAM — Play access is granted in Play Console, not here). **No key yet.**
- **Play Console grant** (Users and permissions → Active): *app-scoped* **View app information
  (read only)** + **View app quality information (read-only)** on **`com.altijwal.prayer` only** —
  the account has three other apps and the SA has no business reading them — **plus** account-level
  **"View app information and download bulk reports (read only)"**, which is the permission that
  actually unlocks the Cloud Storage bucket. There is **no app-scoped equivalent for bulk reports**,
  so that one grant is unavoidably account-wide (still read-only, still excludes financial data).
  Everything else — financial, releases, store presence, reply-to-reviews, Play Games — left off.

**What still blocks the page — and it is not effort:**

Verified in the Console on 2026-07-26, all for `com.altijwal.prayer`:

| Source | State |
|---|---|
| Download reports → Statistics (Installs / Crashes / Ratings) | **"No monthly reports available"** |
| Download reports → Reviews | **"No monthly reports available"** |
| App → Statistics, Installed audience, last 28 days | **"Data unavailable"** |

This is **expected for a closed test with 12 testers**, not a defect: Play suppresses low-volume
statistics and does not generate bulk report CSVs at this scale. Consequences:

1. There is nothing to parse, so the handover rule — *verify what the APIs return before building
   UI* — **cannot be satisfied yet**. Building the parser now means shipping unverifiable code
   against a source whose real column names have never been seen.
2. `PLAY_REPORTS_BUCKET` **cannot be filled in yet.** The canonical value comes from *Copy Cloud
   Storage URI*, a button that only renders once a report exists. The documented form is
   `gs://pubsite_prod_rev_<developer-bucket-id>` — do **not** guess it; wait for the button.

**So: revisit this page once the app has real install volume** (production rollout, or a much larger
test cohort). Until then the endpoint correctly reports "not configured".

Remaining step 3, for whoever picks it up: create a JSON key for the SA, put it at
`/opt/prayer/secrets/play-sa.json` on the VPS, bind-mount it, and set `PLAY_SA_KEY_FILE` +
`PLAY_REPORTS_BUCKET`. Keep the key out of the repo, the image and the deploy tarball.

Known gotcha for whoever builds it: **the bulk CSVs are UTF-16 encoded** (Google's own docs say to
convert UTF-16→UTF-8 before loading into BigQuery) — decode before parsing — and the monthly
`installs_<pkg>_<YYYYMM>_<dimension>.csv` is rewritten in place each day.

---

## 10. Operating notes

- **Rotating the password** invalidates every session (§3). Rotating `TELEMETRY_SALT` makes all
  previously stored days mutually unlinkable — harmless, and occasionally useful.
- **The kill-switch fails open.** If Postgres is unreachable, every setting reads its env default.
  This is deliberate: an outage must never silently disable a feature. Verified by
  `db/repositories/app-settings.test.ts` rather than by stopping the shared Postgres, which also
  serves the other apps on this VPS.
- **The log page is not the log.** It is a 500-entry in-memory ring that empties on restart; stdout
  remains the record.
- **Don't trust an empty Audience page as "no users".** It only starts filling from the release that
  added the ping (web: 2026-07-26; Android: 2.3.0 / versionCode 9).

### The demand maps (`components/TileMap.tsx`, 2026-07-26)

The Cost and Audience maps were originally a tile-less SVG scatter (`ScatterMap`, now deleted): plain
circles on the panel background. It **read as a broken map** — solid black — and because it auto-fitted
its viewport to the data extremes, a few sparse cells got pinned to the corners around an empty
middle. At ~1 km resolution the operative question is *which neighbourhood*, which relative position
alone cannot answer, so it now renders a real **Leaflet + OpenStreetMap** basemap.

Things a future editor should not undo by accident:

- **`circleMarker`, never `Marker`.** Leaflet's default pin is a PNG resolved relative to the CSS;
  bundlers famously break that path. Using vector circles means no icon asset is ever requested.
- **The dark look is a CSS filter on `.leaflet-tile-pane` only** (`admin.css`), not a second tile
  provider. `invert(1)` darkens the paper and lightens the labels; `hue-rotate(180deg)` restores the
  hues (drop it and the water turns orange). The filter is scoped to the tile pane so our teal
  circles and the attribution are untouched.
- **Attribution must stay visible** — OSM's tile policy requires it. It is themed, never dimmed away.
- **`scrollWheelZoom` is off**, so the map cannot trap a page scroll. Buttons and double-click zoom.
- **`maxZoom` on fit is capped at 13.** A 1 km cell is a neighbourhood; zooming to building level
  would imply precision the data does not have and invite reading a cell centre as an address.
- The map is invisible to screen readers, so the same figures are emitted as an `sr-only` list of the
  top cells (the Cost page also has the full ranking as a labelled bar list underneath).
- Leaflet lives **only** in the admin bundle. Verified after every build: `dist/` (the SPA, which is
  what Capacitor packages into the APK) contains no `leaflet`.
