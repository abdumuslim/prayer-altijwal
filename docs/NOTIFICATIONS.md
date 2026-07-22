# Notifications (web-push)

> **2026-07-22 — there is NO default reminder rule any more.** Both seeds were removed (native
> `local-alerts-store.ts`, web `NotificationsOptIn.tsx`); a one-time migration deletes the old
> 10-min/5-fard rule from devices that were seeded, and ONLY while it still matches the seeded shape
> exactly (id 1 · before · 10 min · notification · the five fard in any order) — an edited rule is
> kept. Markers: `prayer.alerts.default-removed.v1` (native) /
> `prayer.web-default-alert-removed.v1` (web). §3a's "one default rule is seeded" no longer applies.


Prayer reminders via the Web Push API: a notification fires ahead of (or at) each chosen prayer,
even when the tab is closed. This ports home's proven `web-push` mechanics and **fixes its two
structural weaknesses** for a multi-location service. Design reference — no code yet.

Related: `ARCHITECTURE.md` §4, `PRAYER_TIMES_API.md` (push endpoints), `DEPLOYMENT.md` (VAPID, DB).

---

## 1. Client: service worker + permission + subscription

1. User toggles **Prayer reminders** → request `Notification.permission`.
2. Register `public/sw.js` (`navigator.serviceWorker.register('/sw.js')`). The SW handles `push`
   (show notification from the JSON payload — `{ title, body }`, built server-side; **`kind:'alarm'`
   branches to the full-screen-alarm path — §3b**) and `notificationclick` (focus/open the app; alarm
   clicks route into the overlay). `app.ts` serves `.js` with `no-cache`, so an updated `sw.js` is
   picked up on the next visit.
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
-- its `prayers` at `timing` ('at_time' | N minutes 'before' | N minutes 'after').
-- A device owns many. This REPLACES the single lead_minutes/prayers arrays above
-- (those columns stay for back-compat but the scheduler reads only this table).
CREATE TABLE IF NOT EXISTS prayer_alert_rules (
  id          SERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  timing      TEXT NOT NULL CHECK (timing IN ('at_time','before','after')),
  minutes     INTEGER,                          -- minutes before/after; null when at_time
  prayers     TEXT[] NOT NULL,                  -- AlertTarget[]: the five fard + duha/qiyam/
                                                --   adhkar_morning/adhkar_evening (no value CHECK;
                                                --   zod is the only gate)
  kind        TEXT NOT NULL DEFAULT 'notification'  -- 'notification' | 'alarm' (§3b)
                CHECK (kind IN ('notification','alarm')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prayer_alert_rules_endpoint ON prayer_alert_rules (endpoint);

-- 2026-07 migration: widen the timing CHECK to include 'after' on already-deployed
-- tables (CREATE TABLE IF NOT EXISTS never alters an existing table). Idempotent pair;
-- verify the auto-name once on the VPS via pg_constraint.
ALTER TABLE prayer_alert_rules DROP CONSTRAINT IF EXISTS prayer_alert_rules_timing_check;
ALTER TABLE prayer_alert_rules ADD CONSTRAINT prayer_alert_rules_timing_check
  CHECK (timing IN ('at_time','before','after'));

-- 2026-07 migration: per-rule `kind`. ADD COLUMN IF NOT EXISTS covers deployed
-- tables (existing rows default to 'notification'); the DROP/ADD pair normalizes
-- the CHECK name. Idempotent. Verify prayer_alert_rules_kind_check via pg_constraint.
ALTER TABLE prayer_alert_rules ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'notification';
ALTER TABLE prayer_alert_rules DROP CONSTRAINT IF EXISTS prayer_alert_rules_kind_check;
ALTER TABLE prayer_alert_rules ADD CONSTRAINT prayer_alert_rules_kind_check
  CHECK (kind IN ('notification','alarm'));

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
first enable, one **default rule** is seeded (5 fard, 10 min before). Client pieces:

- `usePushSubscription(endpoint)` — manages the subscription lifecycle only (subscribe/unsubscribe,
  re-subscribe on location/method/lang change) and exposes the `endpoint`.
- `usePrayerAlerts(endpoint)` — loads + mutates the rules via `/api/push/alerts`.
- `NotificationsOptIn` (enable/disable + the rule list with add/edit/delete) + `AlertForm` (one rule).
- **Targets & timing (2026-07):** `AlertForm` offers two chip groups — the five fard, then the
  sunnah/adhkar group `duha`/`qiyam`/`adhkar_morning`/`adhkar_evening` (`lib/alert-targets.ts` +
  `ui/icons.ts ALERT_TARGET_ICONS`; labels reuse `sunnah.*`/`adhkar.*`). Timing is a 3-way radio:
  at-time / **before** / **after** (N min). "Select all" governs only the fard subset, and a rule
  reads "all prayers" only when it contains every fard (extras appended). `client/src/types/api.ts`
  `AlertTarget` is the union; `PrayerName` stays fard+sunrise only.
- **Kind & custom minutes (2026-07-11):** each rule also carries a **`kind`** — `notification`
  (quiet, the default) or `alarm` (full-screen — §3b). `AlertForm` opens with a two-way
  «إشعار/منبه» segmented control (`Bell`/`AlarmClock`), and the before/after minutes offer a
  **«مخصص» custom stepper** (1–180, clamped client-side; the server zod already allowed 1–180 so
  no schema change was needed). The at-time label was shortened «عند الأذان» → **«عند»**. Alarm
  rules show an `AlarmClock` icon in the rule list; `describeRule` is unchanged.

`localStorage` no longer needs `reminderPrefs` — reminders are server-side.

## 3b. Alarm kind — full-screen phone-style alarm

An `alarm`-kind rule fires a **full-screen alarm UI** (client) instead of a passive notification.
A web app **cannot** replicate an OS alarm when the browser is fully closed; the design is:

- **App open (foreground):** the SW `push` handler finds a **focused visible** client, `postMessage`s
  `{ type: "prayer-alarm", payload }`, and **skips** `showNotification` (Chrome only forgives a missing
  notification under `userVisibleOnly` when a focused client handles it). The page raises
  `AlarmOverlay` (`useAlarm`).
- **App closed / backgrounded:** the SW shows a **persistent** notification (`requireInteraction: true`,
  stronger `vibrate`, `data:{ kind, prayer, firedAt }`). `notificationclick` focuses a live client and
  `postMessage`s it, or cold-opens `/?alarm=<prayer>&t=<firedAt>`; `useAlarm` parses that and raises the
  overlay, then `history.replaceState`-strips the params.
- **Payload** gains `kind`: the scheduler sends `{ ...buildPushPayload(...), kind }`. `alarm` rules use
  **send options** `{ urgency: "high", TTL: 600 }` (`sendPush(sub, payload, options)`) so the push
  service wakes dozing devices and drops a delivery >10 min late (no siren at the wrong time);
  `notification` rules keep web-push defaults. `notification-text.ts` stays a pure text module.
- **Stale guards (triple):** server `TTL 600`; client drops a `postMessage`/URL alarm whose `firedAt`
  is >5 min old; `AlarmOverlay` auto-dismisses after 5 min.
- **Client-side local trigger was rejected:** the SW receives the push in real time even with the page
  open, so `postMessage` covers the foreground case without a second (dedup-prone) firing path.
- **Sound:** the overlay plays a **user-selected MP3** (catalog `client/src/lib/alarm-sounds.ts`, files
  in `client/public/alarms/`; the chosen `alarmSound` id lives in `prayer.app.v1`). It **loops for
  2 min**, then auto-dismisses if untouched. Picked in Settings → reminders (`AlarmSoundPicker`, generic
  «نغمة N» labels + tap-to-preview). Overlay UI detail → `FRONTEND.md` §9.
- **Autoplay:** browsers block audio until the page has a user gesture, so `unlockAlarmAudio()`
  pre-warms the audio element on the app's **first interaction** and on the `AlertForm` kind-switch/save;
  `AlarmOverlay` **retries on every tap** until it plays, and always alerts via pulsing visual +
  `navigator.vibrate`.
- **⚠️ Reach — the key limit (same on iOS & Android):** the ringing alarm (MP3 + full-screen +
  vibration) plays **only while the app/PWA is open**. There is **no local background timer** — a closed
  app runs no code; the server push wakes the SW, which when the app is **closed** can only show a
  **notification** (with the **system** sound, not the MP3; `requireInteraction` + strong vibrate on
  Android). It is NOT a background alarm clock. A true closed-app alarm with a custom ring requires a
  **native wrapper** (Capacitor + Android `AlarmManager`/full-screen intent, **iOS 26 AlarmKit**) —
  scoped in `NATIVE_ALARM_SPEC.md` (offline-first; Android first, iOS deferred).
- **iOS caveat:** push needs the installed PWA (existing hint); `requireInteraction`, SW `vibrate`, and
  `navigator.vibrate` are ignored → iOS closed-app is a plain system notification; the overlay + MP3
  appear only once the app is opened (audio after a prior in-app gesture).

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
  table = cachedTimesFor(sub)                 // extended table (below); recompute at local midnight
  for rule in subRules:
    lead = rule.timing=='at_time' ? 0 : rule.timing=='before' ? +min : -min    // signed
    days = [today] + (rule.timing=='after' ? [yesterday] : [])   // after may cross local midnight
    for (dayKey, table) in days:
      for target in rule.prayers:             // sunrise excluded (informational)
        t = table[target]; if invalid → continue
        minutesLeft = (t - now) / 60000
        if minutesLeft <= lead and minutesLeft > lead - 1.5:    // arming window > tick interval
          fireKey = `${dayKey}-r${rule.id}-${target}`           // PER-RULE, PER-DAY dedup
          won = INSERT push_log(endpoint, fireKey) ON CONFLICT DO NOTHING RETURNING 1
          if won: sendPush(sub, buildPushPayload(target, lead, sub.lang, {friday}))
```
- **Extended per-day table (`computeDefaultTable`)**: the five fard PLUS `duha` (=`duhaWindow(sunrise,
  dhuhr).start`, sunrise+15), `qiyam` (=the last-third-of-night start that lands on this civil day —
  `qiyamAnchorForDay` picks between last-night's and tonight's third), and `adhkar_morning`/
  `adhkar_evening` (= fajr / asr). Three day-sets are computed (yesterday/today/tomorrow, DST-safe from
  solar noon, the same pattern as `payload.ts`) so qiyam resolves to the right side of midnight;
  invalid (high-lat NaN) anchors are omitted. `SCHEDULABLE` gates the target set.
- **Signed lead / "after":** `before` = +minutes (fire early), `after` = −minutes (fire late); the
  arming-window check works unchanged for negative leads. `buildPushPayload` bodies: `lead>0` "in N
  min", `lead==0` a per-target at-time phrase, `lead<0` "N min ago".
- **After crosses midnight:** an `after` fire can land on the next civil day (e.g. isha+180). The
  cache retains the **previous** day's table (`prevTable`) so `after` rules also evaluate yesterday's
  anchor; the `fireKey` carries the anchor's own `dayKey` so dedup stays per-day-correct. (Cold start
  inside that window can miss it — rare, accepted.)
- **Friday title:** `fire()` computes the weekday of the target instant in the sub's tz; on Fridays
  `buildPushPayload` renders dhuhr's title as «الجمعة»/"Jumu'ah" (see FRONTEND §8's client mirror).
- **Per-rule `fireKey`** (`…-r${ruleId}-…`) so two rules covering the same target fire independently
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
  the subscriber's `lang`, so it sends `{ title, body }` already localized (target name + at-time /
  "in N min" / "N min ago"; **Latin numerals**; Friday dhuhr → الجمعة). This fixes a latent bug where
  the SW received no body and showed an empty notification — the SW now just renders `title`/`body`.
  The scheduler appends **`kind`** (`fire()`); `alarm` also passes `{ urgency:"high", TTL:600 }` send
  options (§3b).

---

## 5. Endpoints (contract in `PRAYER_TIMES_API.md`)

`GET /api/push/vapid-key` · `POST /api/push/subscribe` · `POST /api/push/unsubscribe` ·
`POST /api/push/prefs` · and the reminder-rule CRUD `GET/POST /api/push/alerts`,
`PUT/DELETE /api/push/alerts/:id` (ownership scoped to the `endpoint`; `AlertRuleBody` requires
`minutes` 1–180 when `timing='before'|'after'`; `prayers` is the `AlertTarget` enum; `kind` is
`'notification' | 'alarm'`, defaulting to `notification` so pre-alarm clients keep working). All
zod-validated at the boundary.

---

## 6. Testing focus (the critical one)

Scheduler tests with a fake clock + fake pool: (a) fires exactly once per prayer/lead/day;
(b) `ON CONFLICT` blocks a second fire after a simulated restart (fresh in-memory state, same DB →
no double send); (c) two subscribers in different tz each fire on their own local schedule;
(d) `404`/`410` → subscription deleted. See `FRONTEND.md` for the opt-in UI and
`DECISIONS.md` ADR-003 for scope.
