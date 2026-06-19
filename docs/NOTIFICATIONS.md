# Notifications (web-push)

Prayer reminders via the Web Push API: a notification fires ahead of (or at) each chosen prayer,
even when the tab is closed. This ports home's proven `web-push` mechanics and **fixes its two
structural weaknesses** for a multi-location service. Design reference — no code yet.

Related: `ARCHITECTURE.md` §4, `PRAYER_TIMES_API.md` (push endpoints), `DEPLOYMENT.md` (VAPID, DB).

---

## 1. Client: service worker + permission + subscription

1. User toggles **Prayer reminders** → request `Notification.permission`.
2. Register `public/sw.js` (`navigator.serviceWorker.register('/sw.js')`). The SW handles `push`
   (show notification from the JSON payload — `{ title, body }`, built server-side) and
   `notificationclick` (focus/open the app).
3. `GET /api/push/vapid-key` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
4. `POST /api/push/subscribe` with the subscription **plus the user's chosen location
   (`lat/lon/tz/country`), `method`, `asr`, and `lang`**. **Reminder selections (`prayers`/lead)
   no longer go here** — they live in independent **alert rules** (§3a); subscribe just registers the
   device + where/how to compute its times. `usePushSubscription` re-subscribes on
   location/method/lang change while subscribed.

> ⚠️ **iOS Safari:** web push works only when the site is **installed as a PWA** ("Add to Home
> Screen", iOS 16.4+). Ship a valid `manifest.webmanifest` + SW; detect iOS-non-standalone and show
> an "Add to Home Screen to enable reminders" hint instead of a failing subscribe. Android + desktop
> Chrome/Firefox work without install.

---

## 2. VAPID keys

Env: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:…`). Generate once with
`npx web-push generate-vapid-keys`; store in the VPS `.env` only (never committed). The backend calls
`webpush.setVapidDetails(...)` at boot. The public key is safe to serve via `/api/push/vapid-key`.

---

## 3. Database — dedicated `prayer` Postgres database

Shared PG16 instance (`rag-postgres-1` on the `rag_default` network); a **separate `prayer`
database** keeps it isolated from home's `home` db. Bootstrap-if-absent + idempotent migrations at
startup (home's `database.ts` pattern). Schema (reference):

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            SERIAL PRIMARY KEY,
  endpoint      TEXT UNIQUE NOT NULL,
  subscription  JSONB NOT NULL,
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  tz            TEXT NOT NULL,                 -- IANA tz of THIS subscriber's location
  country       TEXT,
  method        TEXT NOT NULL DEFAULT 'MWL',
  asr           TEXT NOT NULL DEFAULT 'Standard',
  lead_minutes  INTEGER[] NOT NULL DEFAULT '{0}',                      -- LEGACY: retained, unused
  prayers       TEXT[]  NOT NULL DEFAULT '{fajr,dhuhr,asr,maghrib,isha}',  -- LEGACY: retained, unused
  lang          TEXT NOT NULL DEFAULT 'ar',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Multiple independent reminders per device (ported from home). Each rule fires
-- its `prayers` at `timing` ('at_time' | N minutes 'before'). A device owns many.
-- This REPLACES the single lead_minutes/prayers arrays above (those columns stay
-- for back-compat but the scheduler reads only this table).
CREATE TABLE IF NOT EXISTS prayer_alert_rules (
  id          SERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  timing      TEXT NOT NULL CHECK (timing IN ('at_time','before')),
  minutes     INTEGER,                          -- minutes-before when timing='before'; null at_time
  prayers     TEXT[] NOT NULL,                  -- subset of {fajr,dhuhr,asr,maghrib,isha}
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prayer_alert_rules_endpoint ON prayer_alert_rules (endpoint);

-- Persistent dedup ledger — survives restarts (the fix for home's in-memory Set).
CREATE TABLE IF NOT EXISTS push_log (
  endpoint  TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  fire_key  TEXT NOT NULL,                     -- `${localDateKey}-r${ruleId}-${prayer}` (per-rule)
  fired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (endpoint, fire_key)
);
CREATE INDEX IF NOT EXISTS idx_push_log_fired_at ON push_log (fired_at);
```

A daily prune deletes `push_log` rows older than ~48h. Repo: `db/repositories/alert-rules.ts`
(`PgAlertRulesRepo`: `listByEndpoint`/`listAll`/`create`/`update`/`delete`, all endpoint-scoped).

---

## 3a. Reminder UX — independent rules

Replacing the old single "per-prayer toggles + lead chips" panel: the user builds a **list of rules**,
each `{ timing, minutes?, prayers[] }` (e.g. *all prayers, 10 min before* and *Fajr, at time*). On
first enable, one **default rule** is seeded (all prayers, 10 min before). Client pieces:

- `usePushSubscription(endpoint)` — manages the subscription lifecycle only (subscribe/unsubscribe,
  re-subscribe on location/method/lang change) and exposes the `endpoint`.
- `usePrayerAlerts(endpoint)` — loads + mutates the rules via `/api/push/alerts`.
- `NotificationsOptIn` (enable/disable + the rule list with add/edit/delete) + `AlertForm` (one rule).

`localStorage` no longer needs `reminderPrefs` — reminders are server-side.

---

## 4. Scheduler — `push/scheduler.ts` (rule-based)

Home's scheduler computes one Baghdad table for everyone and dedups with an in-memory `Set` reset on
Baghdad midnight. **Three things break for a multi-location service — all fixed here:**

1. **Per-subscriber location/tz.** Compute *each* subscriber's times in *their own* tz:
   `calculatePrayerTimes({lat,lon}, now, { method: sub.method, asr: sub.asr, timezone: sub.tz })`.
2. **Per-tz day boundary.** Key dedup on each subscriber's own local date:
   `localDateKey = now.toLocaleDateString("en-CA", { timeZone: sub.tz })` — not a global midnight.
3. **Restart-safe dedup.** Replace the in-memory `Set` with the `push_log` table. The fire gate is
   `INSERT INTO push_log(endpoint, fire_key) ... ON CONFLICT DO NOTHING RETURNING 1`: if it returns a
   row, this process won the fire → send; if not, it was already fired (another tick, or before a
   restart) → skip. **Idempotent across restarts and overlapping ticks.**

**Tick (~every 30s)** — now **rule-based**: load all subs + all rules, group rules by `endpoint`, and
for each device evaluate its rules against its (cached) per-tz table:
```
subs, rules = listAll(subscriptions), listAll(alert_rules)
rulesByEndpoint = group rules by endpoint
for each sub in subs:
  subRules = rulesByEndpoint[sub.endpoint]; if none → skip   // no reminders configured
  table = cachedTimesFor(sub)                 // cache per (endpoint, localDateKey); recompute at local midnight
  for rule in subRules:
    lead = rule.timing == 'at_time' ? 0 : max(0, rule.minutes)
    for prayer in rule.prayers:               // sunrise excluded (informational)
      t = table[prayer]; if invalid → continue
      minutesLeft = (t - now) / 60000
      if minutesLeft <= lead and minutesLeft > lead - 1.5:    // arming window > tick interval
        fireKey = `${localDateKey}-r${rule.id}-${prayer}`     // PER-RULE dedup
        won = INSERT push_log(endpoint, fireKey) ON CONFLICT DO NOTHING RETURNING 1
        if won: sendPush(sub.subscription, buildPushPayload(prayer, lead, sub.lang))
```
- **Per-rule `fireKey`** (`…-r${ruleId}-…`) so two rules covering the same prayer fire independently
  and dedup separately. Everything else from home's hardening is **kept**: the restart-safe `push_log`
  ledger (no regression to an in-memory Set) and the per-`(endpoint, localDateKey)` table cache.

- **Window vs tick:** the ~1.5-min arming window must exceed the 30s tick so no fire is skipped
  between ticks; the DB dedup prevents the duplicate sends a wide window would otherwise cause.
- **Cleanup:** on send error `404`/`410` → `DELETE FROM push_subscriptions WHERE endpoint=$1`
  (cascades to `push_log`). (Home's logic, now correct because the cascade clears the ledger too.)
- **DST:** handled automatically — times are recomputed daily per-subscriber via the engine's
  `zonedMidnightUtc`/offset machinery using each subscriber's IANA tz.
- **Caching:** in-memory `Map<endpoint, {dateKey, table}>` avoids recomputing the ephemeris every
  tick; invalidate when the subscriber's `localDateKey` rolls. Cold start recomputes — fine.
- **Payload built server-side** (`push/notification-text.ts` `buildPushPayload`): the scheduler has
  the subscriber's `lang`, so it sends `{ title, body }` already localized (prayer name + "It's time" /
  "in N minutes"; **Latin numerals**). This fixes a latent bug where the SW received no body and showed
  an empty notification — the SW now just renders the given `title`/`body`.

---

## 5. Endpoints (contract in `PRAYER_TIMES_API.md`)

`GET /api/push/vapid-key` · `POST /api/push/subscribe` · `POST /api/push/unsubscribe` ·
`POST /api/push/prefs` · and the reminder-rule CRUD `GET/POST /api/push/alerts`,
`PUT/DELETE /api/push/alerts/:id` (ownership scoped to the `endpoint`; `AlertRuleBody` requires
`minutes` 1–180 when `timing='before'`). All zod-validated at the boundary.

---

## 6. Testing focus (the critical one)

Scheduler tests with a fake clock + fake pool: (a) fires exactly once per prayer/lead/day;
(b) `ON CONFLICT` blocks a second fire after a simulated restart (fresh in-memory state, same DB →
no double send); (c) two subscribers in different tz each fire on their own local schedule;
(d) `404`/`410` → subscription deleted. See `FRONTEND.md` for the opt-in UI and
`DECISIONS.md` ADR-003 for scope.
