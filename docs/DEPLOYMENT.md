---
type: Runbook
title: 'Deployment'
description: 'How prayer.altijwal.com is built and shipped. It deploys as a sibling of the home dashboard on the same VPS: one Docker container behind Traefik. Non-secret details only — VPS IP, SSH key, and secrets live in…'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# Deployment

How prayer.altijwal.com is built and shipped. It deploys as a **sibling of the home dashboard** on
the same VPS: one Docker container behind Traefik. Non-secret details only — VPS IP, SSH key, and
secrets live in `OPERATIONS.md` (gitignored). Design reference — no code yet.

Related: `ARCHITECTURE.md`, `NOTIFICATIONS.md` (DB + VAPID), `OPERATIONS.md` (sensitive).

---

## 1. Server stack (inherited from home)

```
Browser → Cloudflare (DNS + origin SSL) → Traefik (VPS, :80/:443) → prayer container (:8000)
                                                                       ├─ Express API + static SPA
                                                                       └─ Postgres `prayer` db (shared PG16)
```

- **Reverse proxy:** Traefik (no nginx/apache). TLS via the existing Cloudflare origin certs at
  `/opt/rag/` — **no per-app cert work**.
- **DNS:** `prayer.altijwal.com` → server IP, already set in Cloudflare.
- **Network:** the external Docker network `rag_default` (pre-created by the `/opt/rag/` stack).
- **Database:** shared PG16 container `rag-postgres-1`; this app uses a dedicated `prayer` database.

---

## 2. Container

**Dockerfile** — multi-stage Node 22-slim, copied from home and simplified:
1. **server-build** — `tsc` the Express server. **Built first** (2026-07-11) so the client stage can
   reuse its source tree + `node_modules`.
2. **client-build** — `vite build` the React app. **Copies the full built server tree from
   server-build** (`COPY --from=server-build /build/server /build/server`) because the native
   (Capacitor) **offline chunk imports the reused engine + wrappers + calibration data verbatim** from
   `../server` (hard rule 2). The client build type-checks (`tsc -p tsconfig.native.json`) and bundles
   them, and resolves `pino`/`astronomy-engine` **types from `server/node_modules`** — so `src`, `data`,
   AND `node_modules` must all be present at `../server`. Web users never load the resulting engine
   chunk (code-split behind `isNative()`; `NATIVE_ALARM_SPEC.md` §3b). **Without this the web build
   fails** (`Cannot find module '../../../server/...'` / `'pino'`).
3. **production** — Node 22-slim; copy server `dist` + `node_modules` + the built client static
   files + `server/data/cities15000.json`; serve on **port 8000**.
   - **Two client bundles** (2026-07-26): the client stage runs `npm run build` **and**
     `npm run build:admin`, and production copies `client/dist` → `./static` (the SPA, also what
     Capacitor packages into the APK) and `client/dist-admin` → `./static-admin` (the operator
     dashboard at `/admin`, web-only). See `docs/ADMIN_DASHBOARD.md` §1.
   - Drop home's `bias-table.json` copy line (weather-only, not used here).
   - Express serves `/api/*` and the SPA (history-mode fallback to `index.html` for non-`/api` routes).
   - **CORS** is enabled on `/api/*` (for the native origin `https://localhost`); harmless for the SPA.

**docker-compose.yml** — copy home's and **rename every Traefik label** `home.*` → `prayer.*`
(a duplicate router name on the shared Traefik silently breaks routing):

```yaml
services:
  prayer:
    build: .
    restart: unless-stopped
    mem_limit: 1g
    cpus: 1.0
    logging:                          # cap container-log growth on the shared box
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
    env_file: .env
    networks: [rag_default]
    labels:
      - traefik.enable=true
      - traefik.http.routers.prayer.rule=Host(`prayer.altijwal.com`)
      - traefik.http.routers.prayer.tls=true
      - traefik.http.routers.prayer.entrypoints=web,websecure
      - traefik.http.services.prayer.loadbalancer.server.port=8000
networks:
  rag_default:
    external: true
```

### Origin lockdown — Cloudflare-only access to the `prayer` router

**Status: APPLIED AND VERIFIED 2026-07-26** (owner-approved).

**Why.** `clientIpOf` trusts `cf-connecting-ip` / `x-forwarded-for` to identify a client, and two
defences key off it: the admin login throttle (`ADMIN_DASHBOARD.md` §3) and the Places per-client
quotas (ADR-014). Anyone reaching the origin IP **directly** can rotate those headers at will and
dodge both. In-app backstops exist (global login lockout, 5000/hour telemetry cap), so this is
defence in depth, not a hole — but the origin should not be directly reachable at all: it already
serves only **Cloudflare origin certs**, which are invalid for any non-Cloudflare client, so
direct access was never a supported path.

**Design — scoped to the router, deliberately NOT the entrypoint.** The same Traefik
(`/opt/rag/`) fronts **n8n and the home dashboard**. An `ipAllowList` on the shared `websecure`
entrypoint would silently cover those too. So the middleware is declared and attached **in this
app's own compose labels**, touching nothing outside `/opt/prayer/`:

```yaml
- traefik.http.middlewares.prayer-cfonly.ipallowlist.sourcerange=<CF v4 + v6 ranges, comma-separated>
- traefik.http.routers.prayer.middlewares=prayer-cfonly
```

**Why this matches the real client IP.** Verified on the running proxy: **Traefik v3.6.7**, with
**no `forwardedHeaders.trustedIPs` and no proxyProtocol** in the static config. `ipAllowList`
therefore matches the actual TCP peer — the Cloudflare edge — and cannot itself be spoofed by a
header. (v3 spelling is `ipallowlist`; v2's `ipwhitelist` is gone.)

**Pre-flight already confirmed:** `prayer.altijwal.com` resolves to Cloudflare IPs
(`172.67.195.226`, `104.21.60.108`, plus IPv6) and responses carry `Server: cloudflare` + `CF-RAY`,
i.e. the record is proxied. **If it were ever set to DNS-only (grey cloud), these labels would
black-hole the site** — re-check before applying.

Ranges come from `cloudflare.com/ips-v4` + `ips-v6` (22 ranges, fetched 2026-07-26). Both families
are listed even though Cloudflare currently reaches this IPv4-only origin over v4.

**How to verify — ⚠️ do NOT test direct-to-origin from a workstation.** Connecting to
`31.97.76.221:443` from outside is reset for **every** app on this box (`home.altijwal.com` behaves
identically and has no allowlist), so that test returns "blocked" whether or not the middleware
exists — it proves nothing and will fool you. Test **from the VPS**, where the source IP
(`127.0.0.1`) is genuinely outside Cloudflare's ranges, and always compare against a
neighbouring router as the control:

```bash
# on the VPS
curl -sk -o /dev/null -w '%{http_code}\n' --resolve prayer.altijwal.com:443:127.0.0.1 \
     https://prayer.altijwal.com/api/health     # expect 403  ← allowlist working
curl -sk -o /dev/null -w '%{http_code}\n' --resolve home.altijwal.com:443:127.0.0.1 \
     https://home.altijwal.com/                 # expect 200  ← control: neighbour untouched
# from anywhere
curl -fsS -o /dev/null -w '%{http_code}\n' https://prayer.altijwal.com/api/health   # expect 200
```

Recorded result 2026-07-26: prayer **403** / home **200** from the VPS; prayer **200** and home
**200** through Cloudflare; `prayer` is the only router carrying `middlewares`, `home` has none and
`n8n` keeps its own pre-existing `n8n@docker`.

**Rollback:** `cp /opt/prayer/docker-compose.yml.bak-20260726-cfonly \
/opt/prayer/docker-compose.yml && cd /opt/prayer && docker compose up -d` (backup taken 2026-07-26).

**Two consequences to remember:** debugging by curling the origin IP directly with a `Host:` header
stops working (use Cloudflare, or temporarily roll back); and if Cloudflare ever publishes new
ranges, a site-wide 403 is the symptom — re-fetch the two lists first.

---

## 3. Environment (`.env` on the VPS only)

`.env.example` (committed, placeholders) lists:

```
DATABASE_URL=postgresql://USER:PASSWORD@rag-postgres-1:5432/prayer
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@altijwal.com
GOOGLE_MAPS_API_KEY=          # optional — nearest-masjid Places proxy; absent ⇒ feature disabled
GOOGLE_MAPS_EMBED_KEY=        # optional — browser-visible Embed-only key (ADR-013)
# optional: PLACES_MONTHLY_UNIT_CAP=4500   # ADR-014 spend ceiling, in units
# optional: ADMIN_TOKEN=                   # gates GET /api/places/usage (min 16 chars)
# optional: PORT=8000
# optional: PG_POOL_MAX=10                 # Postgres pool ceiling (1–50; shared cluster, keep modest)
# ── admin dashboard + telemetry (2026-07-26, docs/ADMIN_DASHBOARD.md) ──
ADMIN_PASSWORD_HASH=      # scrypt digest; absent ⇒ the whole /api/admin tree 404s
ADMIN_SESSION_SECRET=     # ≥32 chars; absent ⇒ random per boot ⇒ logged out on every deploy
TELEMETRY_SALT=           # ≥16 chars; absent ⇒ the audience ping stores nothing
# optional: TELEMETRY_RETENTION_DAYS=180 · TELEMETRY_PRECISION_DEG=0.01
# optional (Play stats): PLAY_SA_KEY_FILE= · PLAY_PACKAGE_NAME= · PLAY_REPORTS_BUCKET=
```

⚠ **Docker Compose interpolates `$` inside `env_file` values.** A value containing `$` reaches the
container mangled — every `$name` replaced by an empty string, with only a warning on stderr during
`up`. This silently broke admin login on the first deploy (2026-07-26). Keep `.env` values free of
`$` (the password digest uses `:` separators for exactly this reason) or escape each one as `$$`.

Config is **zod-validated at startup** — the process fails fast if a required secret is missing
(coding-style: validate at boundaries, never run half-configured). Generate VAPID once with
`npx web-push generate-vapid-keys`. Real values live only in `OPERATIONS.md` / the VPS `.env`.
`GOOGLE_MAPS_API_KEY` is **optional even in production** (`docs/QIBLA_MASJID_SPEC.md` Q2): without
it `/api/places/masjids` returns `{ enabled: false }` and the client hides the section. The key is
IP-restricted to this VPS + API-restricted to Places API (New), with a daily quota cap (details in
`OPERATIONS.md`).

**Spend controls (ADR-014).** `PLACES_MONTHLY_UNIT_CAP` (default 4500) is the server's own ceiling on
paid upstream work; the GCP-side per-key daily quota remains the hard billing backstop behind it.
Set the console fuses to roughly **200 Places requests/day** and **400 Routes elements/day**. Watch
the live picture with `GET /api/places/usage?token=$ADMIN_TOKEN` — it reports the monthly spend, the
day's pool, the current per-client cap and the observed active-client count.

**New tables** (created by the idempotent DDL at boot, no migration step): `places_cache`,
`places_usage`, `places_stats`, `places_cell_demand`, `masjid_contributions`, and — since
2026-07-26 — `usage_ping`, `app_settings`, `admin_audit`, `push_stats`, `play_stats`. Retention for
all of them is enforced by one daily sweep in `server/src/db/retention.ts`.

**Bundled dataset.** `server/data/masjids-iq.json` ships in the image like `cities15000.json`.
Regenerate with `npm --prefix server run build:masjids`. Its absence is not fatal — the feature just
loses its free floor and leans on Google.

---

## 4. Database bootstrap

At startup the app connects to the PG instance, **creates the `prayer` database if absent** (connect
to `/postgres` first, `CREATE DATABASE prayer`), then runs the idempotent migrations
(`push_subscriptions`, `push_log` — see `NOTIFICATIONS.md`). Use a least-privilege role; if it can't
create databases, pre-create `prayer` and let the app run migrations only.

### Backups (VPS cron)

`scripts/vps-backup-prayer.sh` (ships in the tarball) takes a daily **`pg_dump --format=custom`** of
the dedicated `prayer` database via `docker exec` into the shared PG16 container, writing timestamped
dumps to `/opt/prayer/backups` and pruning anything older than **14 days**. It only ever touches its
own `prayer-*.dump` files (safe on the shared box) and overrides via env: `BACKUP_DIR`, `KEEP_DAYS`,
`DB_NAME`, `PG_CONTAINER`. Install it once as a VPS cron (the exact line is in the script header):

```bash
chmod +x /opt/prayer/scripts/vps-backup-prayer.sh
crontab -e   # add (runs daily at 03:20 UTC):
20 3 * * * /opt/prayer/scripts/vps-backup-prayer.sh >> /var/log/prayer-backup.log 2>&1
```

Restore a dump into the `prayer` database with `pg_restore` (custom format), e.g.
`docker exec -i rag-postgres-1 pg_restore -U postgres -d prayer --clean < /opt/prayer/backups/prayer-<stamp>.dump`.

---

## 5. Deploy sequence (same as home)

> ⚠️ **`docker-compose.yml` is in the tarball, and step 3 overwrites the VPS copy.** So any label
> added on the server by hand is silently reverted by the next deploy. Change it **in the repo** and
> let it ship — that is how the Cloudflare `ipAllowList` above survives redeploys. (Caught 2026-07-26
> one command before it would have undone the origin lockdown.)

```bash
# 1. tarball (exclude node_modules, dist, .git, and the gitignored sensitive ops doc —
#    `docs/OPERATIONS.md` must never land on the VPS)
#
#    ALSO exclude client/android and server/data/_raw. Neither is used by the Docker build
#    (verified: the Dockerfile mentions android only in a comment, and `npm run build:cities` /
#    `build:masjids` are never run on the VPS) and together they are ~90% of the bytes —
#    android/ alone carries the built APKs/AABs plus the gradle cache. Without these two
#    the tarball is 160 MB; with them, 35 MB.
#    docs/refs is also excluded (2026-08-12): it now carries the full-year Waqf poster
#    archive (~75 MB of JPGs) — reference material only, never read by the server.
tar czf /tmp/prayer-deploy.tar.gz --exclude=node_modules --exclude=dist --exclude=dist-admin \
  --exclude=.git --exclude=docs/OPERATIONS.md --exclude=docs/refs \
  --exclude=client/android --exclude=server/data/_raw \
  server client scripts Dockerfile docker-compose.yml .env.example docs

# 1b. always confirm the ops doc did not slip in
tar tzf /tmp/prayer-deploy.tar.gz | grep -i OPERATIONS.md && echo "LEAK — stop" || echo "clean"

# 2. upload  (SSH/SCP specifics — host, key — in OPERATIONS.md)
scp /tmp/prayer-deploy.tar.gz <vps>:/tmp/

# 3. extract + build on the VPS
#    `tar xzf` over an existing tree ADDS/overwrites but never DELETES: a file removed
#    since the last deploy lingers on the VPS and can break the build (e.g. a deleted
#    component still importing a now-removed symbol — happened 2026-06-20). Clear the
#    source trees first so deletions propagate. `.env` lives in the /opt/prayer ROOT,
#    not in these dirs, so it is preserved.
ssh <vps> "mkdir -p /opt/prayer && cd /opt/prayer && rm -rf client server docs && \
           tar xzf /tmp/prayer-deploy.tar.gz && \
           docker compose up -d --build && docker builder prune -f --filter until=48h"

# 4. verify
curl -fsS https://prayer.altijwal.com/api/health
```

**VPS dir:** `/opt/prayer/` (mirrors `/opt/home-dashboard/`). The `.env` is placed there once and is
not part of the tarball.

> **Reclaiming disk after a rebuild, stay scoped.** `docker compose up -d --build` leaves the previous
> image untagged (`<none>`). Reclaim **only this project's** dangling layers:
> ```bash
> docker image prune -f --filter label=com.docker.compose.project=prayer
> ```
> ⚠️ **Never `docker image prune -a` on this shared host** (the standing caution in §7): it would
> delete on-demand images used by the sibling apps. Build cache is handled separately by the
> `docker builder prune` in step 3.

---

## 6. Verification checklist

- `https://prayer.altijwal.com` serves over TLS via Traefik (valid cert, correct router).
- `GET /api/health` → `{ ok: true, db: "up" }`.
- `prayer` database exists; migrations applied.
- `GET /api/prayer-times?...` returns correct tz-formatted times for a couple of distinct locations.
- A real push subscription receives a reminder at the right instant (`NOTIFICATIONS.md`).

---

## 7. Inherited cautions (full detail in `OPERATIONS.md`)

- ExpressVPN (WireGuard) blocks SSH/SCP to the VPS — disconnect before deploying.
- Don't run `docker image prune -a` on this host (removes an on-demand image used elsewhere); prune
  build cache with `docker builder prune -af` when it bloats.
- VPS clock is **UTC**; never rely on server-local wall-clock for prayer logic — always pass an
  explicit IANA tz (the engine + scheduler already do).
