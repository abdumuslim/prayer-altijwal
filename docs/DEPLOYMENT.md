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
```

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
`places_usage`, `places_stats`, `places_cell_demand`, `masjid_contributions`.

**Bundled dataset.** `server/data/masjids-iq.json` ships in the image like `cities15000.json`.
Regenerate with `npm --prefix server run build:masjids`. Its absence is not fatal — the feature just
loses its free floor and leans on Google.

---

## 4. Database bootstrap

At startup the app connects to the PG instance, **creates the `prayer` database if absent** (connect
to `/postgres` first, `CREATE DATABASE prayer`), then runs the idempotent migrations
(`push_subscriptions`, `push_log` — see `NOTIFICATIONS.md`). Use a least-privilege role; if it can't
create databases, pre-create `prayer` and let the app run migrations only.

---

## 5. Deploy sequence (same as home)

```bash
# 1. tarball (exclude node_modules, dist, .git, and the gitignored sensitive ops doc —
#    `docs/OPERATIONS.md` must never land on the VPS)
tar czf /tmp/prayer-deploy.tar.gz --exclude=node_modules --exclude=dist --exclude=.git \
  --exclude=docs/OPERATIONS.md \
  server client Dockerfile docker-compose.yml .env.example docs

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
