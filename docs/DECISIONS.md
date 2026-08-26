---
type: Playbook
title: 'Decisions (ADR log)'
description: 'Decision log for prayer.altijwal.com. Each entry: the decision, the context, why, and the consequences. These are the load-bearing choices the rest of the docs assume. One-line summaries of these live in AGENTS.md and…'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# Decisions (ADR log)

Decision log for **prayer.altijwal.com**. Each entry: the decision, the context, why, and the
consequences. These are the load-bearing choices the rest of the docs assume. One-line summaries
of these live in `AGENTS.md` and the Tier-2 `MEMORY.md`; the full rationale is here.

Status legend: ✅ accepted · 🔭 deferred (future) · ⚠️ has a known nuance to respect.

---

## ADR-001 — Compute architecture: Backend API ✅

**Decision.** A **Node 22 + Express 5 + TypeScript** backend reuses the home `prayer-engine`
**verbatim** and exposes a JSON HTTP API. A **React 19 + Vite 7 + Tailwind 4** client fetches it.
Express serves both the static client build and the `/api/*` routes from one container on internal
port 8000, behind Traefik.

**Context.** The engine can run in the browser with a ~3-line change (swap the Node-only
`createRequire` in `astro.ts` for a normal `import`), which would allow a fully static client-side
PWA. We chose the backend approach instead.

**Why.**
- Reuses the engine and the home payload-builder with **zero engine edits** — lowest risk, highest fidelity.
- Mirrors the home dashboard's proven shape (engine on server, client consumes JSON instants and
  ticks the countdown locally) so ops/deploy/debugging knowledge transfers directly.
- A server is **required anyway** for the chosen MVP feature set: web-push needs a backend
  (VAPID, subscription storage, a server-side scheduler) and the geocoding dataset is served server-side.

**Consequences.**
- The browser must send the **target location's** `lat`, `lon`, and **IANA timezone** to the API
  (see ADR-005 nuance in ARCHITECTURE.md — the target tz, not the device tz).
- `astronomy-engine` stays **server-only**; it must never be imported into the client bundle.
- One container, one image, one Traefik router (`prayer.*`). See `DEPLOYMENT.md`.

---

## ADR-002 — Calculation method: auto-detect by location ✅ ⚠️

> **Reversed (this revision):** two changes from the original ADR. **(a) Iraq is now nationwide.** The
> calibrated `BaghdadYMA` profile (offsets included) applies to the **whole country**, not just
> Baghdad — see the "Nationwide Iraqi method" box below; the old Baghdad-radius rule is gone. **(b)
> The method/madhab are no longer surfaced to users.** The manual 13-preset picker and the Asr
> Standard/Hanafi selector were removed from the UI (ADR-003); method is still auto-resolved
> server-side and returned in the API `method` object, but the app never shows YMA/MWL names or a
> madhab. A **governorate quick-pick** (pick your city from your country's admin-1 capitals) replaced
> the manual override as the only location-tuning control. The historical decision and its
> per-country detection table below remain accurate; only the Iraq policy and the UI exposure changed.

**Decision (current).** Default the calculation method by the user's **location** (country → the
official method for that place), with **no user-facing method/madhab controls**. Iraq uses the
calibrated Iraqi profile country-wide. Asr is always Standard in the app (the engine still supports
Hanafi).

**Original decision (superseded UI).** Default by location **+** expose a **manual picker** (all 13
presets + Asr Standard/Hanafi) that overrides and is remembered in `localStorage`.

Detection table (country code → method):

| Country/region | Method | Notes |
|---|---|---|
| IQ (Iraq) | `BaghdadYMA` ⚠️ | Iraqi Sunni Endowment convention — see nuance below |
| EG | `Egyptian` | |
| SA | `UmmAlQura` | Hajj basis |
| TR | `Diyanet` | |
| US, CA | `ISNA` | |
| PK, IN, BD, AF | `Karachi` | |
| AE | `Dubai` | |
| QA | `Qatar` | |
| KW | `Kuwait` | |
| SG, MY | `Singapore` | |
| IR | `Tehran` | |
| *(all others)* | `MWL` | Global default |

**⚠️ Nationwide Iraqi method (current rule).** `BaghdadYMA` is MWL angles (Fajr 18° / Isha 17°,
Standard Asr) **plus calibration**: `+5` Dhuhr, `+3` Asr, `+2` Maghrib minute offsets, a Fajr floor,
and a fixed 34 m observer elevation, fitted to the Iraqi Sunni Endowment's *printed* Baghdad calendar
(≤1 min over 38 dates). This calibrated profile is now applied to the **entire country** (cc=IQ) —
not Baghdad only.

**Why the reversal.** The original ADR assumed the offsets encoded a *Baghdad* convention. The
official **ديوان الوقف السني poster for 4 Muharram 1448 / 19 June 2026** publishes a
**per-governorate** table computed with **one unified Iraqi method**. Evaluating our `BaghdadYMA`
profile at each governorate's own coordinates reproduces that poster to **≤2 min** (Baghdad ≤1 min;
14 other governorates within per-prayer tolerances — dhuhr/asr/fajr/isha ≤2 min, sunrise/maghrib
≤3 min, the looser bound only because the profile is fixed at Baghdad's 34 m while the Waqf appears to
use each city's own elevation). So the offsets are a *national* convention, not a local one. Verified
by `server/src/prayer/iraq-governorates.test.ts` (poster regression fixture). This is the
modeling-philosophy the user values: one calibrated general model, validated against the official
authority, rather than a Baghdad-only special case. Detail + tolerances in `PRAYER_ENGINE.md`.

**Why auto-detect (no picker).** Iraqi users expect times matching their local mosque/printed
calendar; nationally-correct defaults beat a single global method. The manual picker was dropped
because the auto-resolved method is correct for the audience and surfacing YMA/MWL/madhab names added
noise without value (ADR-003); travellers are served by the governorate quick-pick + GPS rather than a
method override.

**Consequences.** Needs a country resolver from GPS — see `GEOCODING.md`. The country→method table
lives in a small server module (`prayer/method-detect.ts`); for IQ it short-circuits to the calibrated
profile (no radius check). `compute.ts` uses BaghdadYMA's baked-in 34 m for all of Iraq.

**Default location = Baghdad (2026-06-19).** The app opens on Baghdad (`33.3152, 44.3661`,
`Asia/Baghdad`) with **no auto-GPS prompt** — Iraq-centric audience. GPS is **opt-in** (the "Use my
location" button in the search panel); city search + the governorate quick-pick also change it. A
location persisted before Arabic names existed is upgraded once (reverse lookup → `cityAr`). See
`FRONTEND.md` §1.

---

## ADR-003 — MVP feature scope ✅ 🔭

**Decision.** First version ships:
- **Core:** today's six times (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) + a live **next-prayer
  countdown** + **Hijri date** + **next Islamic event**.
- **Web-push reminders** — **multiple independent rules** per device, each firing chosen prayers
  at-time or N-minutes-before (`NOTIFICATIONS.md`).
- **Manual location / city search + governorate quick-pick** — override GPS by searching a city or
  picking one of your country's governorate capitals; remembered (`GEOCODING.md`, `FRONTEND.md`).

**As-built UI simplification (this revision).** No method/source UI: the manual calculation-method
picker and the Asr Standard/Hanafi selector were **removed** (method auto-resolves server-side and is
never shown; Asr is always Standard in the app — see ADR-002). The governorate quick-pick replaced the
manual method override as the location-tuning control. Reminders grew from a single per-prayer/lead
toggle set into the multi-rule model above.

**Added (hero worship-time aids, later revision).** The hero card gained three secondary aids
(detail + final geometry in `FRONTEND.md` §5; engine math reuses `prayer-engine/sunnah.ts` via
`PRAYER_TIMES_API.md`'s `duhaWindow`/`qiyamWindow`):
- **Duha (الضحى) + Qiyam-al-Layl (last third of night) satellites** — two mini rings flanking the
  main ring (amber / indigo), active during their window with a depleting arc + countdown, dimmed
  otherwise. Purely informative. **Now opt-in and off by default** (ADR-007, 2026-07-04) — each has
  its own Settings switch (`features.duha`/`features.qiyam`).
- **Iqama countdown bar** — appears between a prayer's adhan and its iqama; per-prayer adhan→iqama
  minutes are **user-configurable** in Settings (localStorage `iqamaMinutes`, defaults Fajr 25 /
  Dhuhr 15 / Asr 15 / Maghrib 5 / Isha 10; sunrise excluded). **Bar colour uses the absolute
  proximity palette** (15/10/5/1 min to iqama), same as the hero ring — chosen over a
  progress-relative scheme so "within 5 min = red" holds (Maghrib's 5-min window is red throughout;
  Isha orange→red; Fajr walks the full palette). The main ring + name + countdown were shrunk one
  step (224→208, etc.) to make room.

🔭 **Deferred (future, documented hooks only):** Qibla compass, monthly times table. *(Both since
picked up: the monthly table shipped with v2 — Times tab, `V2_REDESIGN_SPEC.md` Phase 5 (**removed
from the app again on 2026-07-23 — unused and it rebuilt a month per tab visit; the server endpoint
stays, `FRONTEND.md` §11**); Qibla is
spec'd — expanded with a nearest-masjid finder — in `QIBLA_MASJID_SPEC.md`, 2026-07-13, not yet
built.)*

**Why.** Matches the user's selection. Notifications + city-search are the two features that change
the architecture (backend + DB + geocoding), so they are scoped in deliberately; Qibla/monthly are
cheap, additive, and can land later without rework.

**Consequences.** Requires a `prayer` PostgreSQL database for push subscriptions and a server-side
scheduler. The core app (everything except push) is independently shippable first.

---

## ADR-004 — Localization: bilingual AR/EN, Arabic default, RTL ✅

**Decision.** Bilingual Arabic/English, **Arabic-only in the UI as of 2026-06-30** (reversed the
user-facing toggle). The UI is **locked to Arabic** — `main.tsx` hardcodes `initialLang="ar"`,
ignoring any stored preference and the browser language; the language picker was removed from
Settings. Layout is **RTL-aware** (`dir`/`lang` on the root, CSS logical properties). Prayer names +
place names (city/country/governorate) are localized too (`lib/locale.ts`, `Intl.DisplayNames` +
dataset `nar`). **English is retained in the codebase** (dictionaries, `Lang` type,
`setLang`/`toggleLang`, the `LanguageToggle` component, the `language` storage key) for future
re-enablement — restore the stored-`language` lookup in `main.tsx` + the picker in `SettingsPanel`.

**Why.** The audience is Iraq-centric (via altijwal.com); Arabic-first serves them best. The toggle
was dropped so every visitor always lands in Arabic with no way to drift to English (and no stale
`"en"` choice surviving), while keeping the English layer ready for later.

**Consequences.** A lightweight in-house i18n layer (two flat dictionaries, a `t()` lookup — no heavy
library) and RTL-safe styling. **Numerals are always Latin** (product decision "keep numbers in
English"), even in Arabic mode — Arabic text + Latin digits via the `-nu-latn` locale extension, so
times/countdowns/Hijri read consistently. Arabic font is **Cairo**. Detail in `FRONTEND.md`.

---

## ADR-005 — Documentation system: home's 3-tier "PC storage levels" ✅

**Decision.** Mirror the home project's tiered docs: **Tier 1** always-loaded routers (`AGENTS.md`
committed + `CLAUDE.md` local-only) → **Tier 2** lightweight C-drive memory (feedback/prefs/
credentials + routing index, *no architecture knowledge*) → **Tier 3** `docs/*.md` loaded on demand.

**Why.** Keeps the most-needed info in-context and losslessly compressed, with full detail one hop
away — the user's stated "CPU cache / RAM / SSD" principle. Keeps institutional knowledge across
sessions. See `MEMORY.md` and the Tier-1 routers.

---

## ADR-006 — Gamified worship tracker (client-only, least-distraction) ✅

**Decision (2026-07-03).** Add a **worship tracker with game mechanics**, entirely client-side in
localStorage (no server changes, engine untouched). The user picked **design 3 of 8 numbered live
mockups** (dev preview at `/?design=N`, kept in `client/src/design-preview/`): contextual check-in
inside the hero + four mini rings around the main ring + bottom sheets for detail.

**Points economy** (perfect day = 29): fard **masjid +3 / home (بيت) +2 / missed −1** — "missed" is
only ever an explicit tap, unmarked = 0; bonuses **+1 per act**: each of the 5 rawatib slots
(2+4+2+2+2 = 12 rakaat), each of the 7 adhkar (5 after-prayer + morning + evening), Duha, Qiyam.
Marks unlock at the parent prayer's **adhan** and lock at local **midnight in the location tz**
(hard rule 4); morning adhkar window = fajr→asr, evening = asr→fajr (user's mapping).

**Least-distraction interaction** (user's notes, iterated live): icon-only controls everywhere —
a small icon after the prayer *name* on each card (dashed = unlogged; tap → 3-icon popover;
transient ~2.5 s tooltip teaches "في المسجد +3"); the hero asks "أين صلّيت X؟" with 3 round icons
only *after the iqama window passes* (asking before the prayer happened would be premature — and
the two tall elements would overflow small phones together), then swaps to an "أذكار بعد الصلاة"
chip, then disappears. Corner rings: **rawatib bottom-right (sky), adhkar bottom-left (teal)** —
titles on top like the Duha/Qiyam satellites, caption below; **in progress → arc + "x/y" text
inside** (rawatib rakaat /12; adhkar counts the *daily pair* /2, its arc moving per dhikr item);
**fully done → solid colour-filled disc + bold white check** (same treatment on the satellites;
the caption text below never changes). Score pill (⭐ pts · 🔥 streak) on the hero's top corner
opens the stats sheet. Custom `MosqueIcon` (lucide has none) — deliberately simple silhouette.

**Storage** (`prayer.worship.v1`, its own envelope — NOT `prayer.app.v1`, which `useLocation`
re-parses every render): raw marks per civil day, **62-day full retention + monthly aggregates**
(`compact`), streaks survive compaction via `prefixStreak`; dhikr tap counts persist debounced
(500 ms + pagehide flush). Everything else (score, streak, best, 7-day chart, totals) is always
recomputed (`worship-stats`). 49 vitest tests cover the pure modules (client's first test suite).

**Why.** Achievement mechanics (points, streak flame, perfect-day ring, fill-and-check completion)
motivate consistency, but the main screen stays a prayer clock — every tracker element is ambient
until the moment it's actionable. Detail in `FRONTEND.md` §8.

---

## ADR-007 — Worship features are opt-in (off by default) ✅

**Decision (2026-07-04).** The hero worship-time aids and the gamified tracker (ADR-003 satellites +
ADR-006 tracker) are **all opt-in and off by default.** Settings gains a **"المزايا الاضافية"
(Additional Features)** section with **five independent on/off switches** — صلاة الضحى, قيام الليل,
الرواتب, الأذكار, and السجل (the last gates the fard check-in + score pill + stats/history as one
unit). A fresh user sees only the core prayer-times screen; they enable exactly the aids they want.

**How.** A persisted `features: { duha, qiyam, rawatib, adhkar, record }` object (all `false`) on the
`prayer.app.v1` envelope, plumbed exactly like `iqamaMinutes` (`useSettings().setFeature`,
`coerceFeatures` in `migrate` — missing/legacy → all off). Gating is at the render sites only
(`NextPrayerCountdown` takes a `features` prop; `App` gates the per-card check-in); `useWorshipLog`
still runs so tracking data and `isFriday` keep working. Toggling off **hides** UI without touching
the `prayer.worship.v1` log, so history returns intact when re-enabled. New reusable `ui/Toggle`
switch (`role="switch"`, RTL-aware, emerald-on). Detail in `FRONTEND.md` §4/§5/§8.

**Why.** The app had accumulated many worship features (Duha, Qiyam, rawatib, adhkar, points, history)
that rendered unconditionally, crowding the core prayer clock for users who don't want them. Making
them opt-in keeps the default screen clean while preserving every feature for those who do —
reversing ADR-003's "not configurable" note for the satellites.

**Consequences.** The `record` switch bundles check-in + points + history (they're one gamification
unit); rawatib/adhkar completions still feed the internal score even when the `record` pill is hidden
(invisible until enabled). Regression covered by `client/src/lib/storage.test.ts`.

## ADR-008 — Semantic versioning from v2.0.0 (client package.json = source of truth) ✅

**Decision (2026-07-12).** Adopt **semver** for the app starting at **2.0.0** (the v2 redesign —
`docs/V2_REDESIGN_SPEC.md`). `client/package.json` `version` is the single source of truth, baked
into the bundle as `__APP_VERSION__` (Vite `define`) and shown in Settings → About. Android
`versionName` mirrors it manually; `versionCode` is a plain monotonic **+1 per Play upload**
(unrelated to semver — Play only requires "greater than last"). The server keeps its own
independent `package.json` version (separate release train). Every release adds a `CHANGELOG.md`
entry.

**Increment rule.** MAJOR = UX overhaul / breaking behavior change; MINOR = new user-facing
feature; PATCH = fixes/tuning. The v2 redesign (tabs + themes + reports) is a MAJOR → 2.0.0,
versionCode 2.

**Why.** v1.0 shipped to the Play closed track with a hardcoded `versionCode 1 / versionName "1.0"`
and a dead `0.0.0` in package.json — no discipline for the updates that closed testing now forces
(every upload needs a bumped versionCode). One authoritative number, surfaced in-app, keeps store
listings, bug reports, and docs in sync. Deliberately NOT wired: gradle reading package.json at
build time (over-engineering; versionCode ≠ semver anyway) and CI automation (manual releases for
now — procedure in `PLAY_RELEASE.md` §Post-launch).

## ADR-009 — Qibla + nearest masjid: accuracy-first compass, server-proxied Places ✅

**Decision (2026-07-13, built 2026-07-14).** The Times tab hosts a qibla compass and a
nearest-masjid list (`QIBLA_MASJID_SPEC.md`). Compass accuracy is the differentiator: native uses
the fused ROTATION_VECTOR sensor + Android''s built-in WMM declination (true north,
tilt-compensated); web uses absolute orientation + a server WMM-2025 endpoint
(`/api/geo/declination`, `geomagnetism` package); with no absolute source the card degrades to
static guidance — a needle is NEVER animated from relative sensors. Masjid data comes from Google
Places API (New) behind a server proxy (`/api/places/masjids`): the key lives only in the VPS
`.env` (optional even in production — absent ⇒ `enabled:false` and the client hides the section),
responses cached per ~300 m grid (TTL 24 h, LRU 500) to bound the paid SKU, and the section is
gated on a REAL GPS fix (`StoredLocation.source === "gps"`) — searching from the Baghdad default
would mislead. Directions are deep links (Maps/Waze), no SDK, no map render. The month table was
demoted into a collapsed section whose open state gates its lazy fetch.

**Why.** Generic web qibla compasses are wrong in three stacking ways (relative alpha, no
declination — ~4–5°E in Iraq, no tilt compensation); being honest about capability (static mode,
accuracy chip, calibration prompt) beats a confident-but-fake needle. The server proxy keeps the
paid key out of the bundle and the grid cache keeps cost inside the free tier.

## ADR-010 — Phase-8 accessibility architecture ✅

**Decision (2026-07-14).** A11y is enforced at the SYSTEM level, not per component: one unlayered
token-driven `:focus-visible` rule (themes tune `--focus-ring-*`; contrast = 3px); one `.hit-target`
utility (transparent ::after expansion to ≥48 px, capped per site where real neighbors sit closer);
countdowns are aria-hidden with stable container names (a ticking text is never announced); exactly
ONE live region exists (`TipLiveRegion` — check-in confirmations); sheets move focus in and restore
it without a full trap (aria-modal scopes SR cursors; Escape + backdrop close). Contrast is audited
per THEME at token level (translucent surfaces defeat axe — ratios are computed against composited
backdrops) with axe as the zero-violations gate; per-theme fixes are token edits, never component
forks. At fontScale أكبر the acceptance flips from "no scroll" to "no CLIP": px-fixed geometry
(hero ring, TopBar rows) pins its type via fs125-* caps and cards get flex-shrink-0 so the page
scrolls the overflow instead of silently clipping controls.

## ADR-011 — Places proxy: global upstream budget breaker (security-review-driven) ✅

**Decision (2026-07-14, security review before the Play upload).** `/api/places/masjids` caps LIVE
Google calls at **30 per rolling minute server-wide** (`server/src/places/routes.ts`); past the cap
it returns the retryable `{ enabled:true, masjids:[], degraded:true }` without spending. This is a
correction, not a reversal: ADR-009 claimed "the grid cache keeps cost inside the free tier," but
the review showed the cache only bounds ORGANIC spend — an attacker sweeping unique coordinates
(`lat += 0.01` per request, > the 0.003° grid step) misses the cache on every call and drives an
attacker-controlled Google bill. The breaker is a GLOBAL upstream throttle, not per-user rate
limiting (that remains deliberately absent — Cloudflare fronts `/api/*`), so it does not reopen
that decision. The GCP-side daily quota cap on the key is the hard billing backstop behind it.
Also from the review: masjid deep links carry `rel="noopener noreferrer"` (was `noopener` only).
No CRITICAL/HIGH findings survived; the untrusted Places `name`/`id` are safe (plain JSX text +
`encodeURIComponent` in the Maps/Waze URLs; lat/lon are numbers, so no scheme/host injection).

**Why.** An unauthenticated public endpoint that spends real money per uncached call needs a
server-side circuit breaker independent of the cache; a per-minute global cap fails closed at a
bounded worst case while leaving normal (cache-clustered) traffic untouched.

## ADR-012 — In-app font-size control removed; OS text scaling is the only text-size path ✅

**Decision (2026-07-19, session 5 — v2.1.0).** The Settings «حجم الخط» control (`data-font-scale`
steps 1/1.125/1.25, part of the P8/D6 a11y package) is **removed end-to-end**: `lib/theme.ts`
(`FontScale`/`applyFontScale`), the `prayer.app.v1` field (`migrate()` silently drops a legacy
`fontScale`), the `AppearanceSettings` control, the `index.html` pre-paint stamp, the
`html[data-font-scale]` CSS steps and the i18n keys. Text-size accessibility now rides the OS
alone: Android system font scale → WebView textZoom (MainActivity caps at 130%) → the measured
`data-syszoom` stamp + `fs125-*` compensations (that pipeline is UNCHANGED and stays); web/desktop
users have native browser zoom. This partially reverses D6/P8's "in-app font-size setting" line.

**Why.** Real-device (Pixel) feedback showed the in-app steps broke px-tuned layouts in ways the
compensations could not fully absorb — and the control duplicated what the phone already does
system-wide. Two stacking scale paths (in-app × system) created exactly the clipping bugs the
feature was meant to prevent (the Phase-8.5 anti-stacking guard existed only because of that
duplication). One pipeline — the OS one, which users already know and which covers every app —
is strictly more robust than two.

## ADR-013 — A second, browser-visible Maps key (Embed API only) ✅

**Context.** The masjid rows were redesigned (2026-07-22) so tapping one expands an interactive
Google directions map. ADR-009 keeps the Places key strictly server-side, and it must stay that way:
it is metered and IP-restricted. But an embedded map is rendered by the *browser*, so it needs a key
the client can see.

**Decision.** Provision a **second** API key in the same GCP project (`al-tijwal-483313`), restricted
to the **Maps Embed API** and to our origins (`https://prayer.altijwal.com/*`, plus the Capacitor
WebView's `https://localhost/*`). The server hands it to the client as `embedKey` on
`/api/places/masjids`; absent ⇒ rows expand with the deep-link buttons and no map.

**Why this is safe.** The Maps Embed API is free and unmetered, so a leaked Embed key costs nothing
and unlocks nothing else — the blast radius of exposing it is a stranger embedding maps. The Places
key (billable) and the Routes key usage (billable per element) stay server-side. Reusing the Places
key here would have been the actual security regression.

**Also decided.** Travel times use the **Routes API** `computeRouteMatrix`, not the legacy Distance
Matrix (Legacy-flagged, needs separate enablement). It bills **per element**, so the server requests
times only for the 5 rows the client renders, caches them inside the existing 24 h / ~300 m grid
entry, and ADR-011's breaker charges 3 units per cache miss (1 Places + 2 Routes).

## ADR-014 — Quota resilience: resident data first, spend governed, travel times on demand ✅

**Context (2026-07-25).** The nearest-masjid feature was heading for its free-tier ceiling, and the
ceiling turned out to be far lower than anyone had assumed. Measuring where the money actually went:

| Per cache miss (before) | Billed as | Free tier / month | Misses before exhaustion |
|---|---|---|---|
| 1 × `places:searchNearby` | Nearby Search **Pro** | 5,000 calls | 5,000 |
| 2 × `computeRouteMatrix` × 5 destinations = **10 elements** | Compute Route Matrix **Essentials** | 10,000 elements | **1,000** ← binds |

So the walk/drive times — an *enhancement* — were setting the ceiling for the whole feature, five
times sooner than the masjid search itself. Two further gaps: ADR-011's breaker caps the RATE
(30 units/min) but not the VOLUME, so a sustained sweep could still drain a month in about eight
hours; and the cell cache lived in process memory, so every deploy re-bought every cell.

**Decision.**

1. **Travel times move off the eager path.** The list shows a free estimate derived from
   straight-line distance (`places/travel-estimate.ts`, walk 5 km/h, drive 30 km/h, ×1.3 detour),
   labelled «نحو …». A real Routes lookup is spent only when the user EXPANDS a row
   (`GET /api/places/travel`, 2 elements, cached). Ceiling: 1,000 → 5,000 lookups/month.
2. **A resident dataset becomes the floor.** `server/data/masjids-iq.json` is built from
   OpenStreetMap (`npm run build:masjids`, ODbL, attribution rendered under the list) and loaded into
   `places/resident-index.ts`. Where it is genuinely dense (≥1 masjid within 1 km AND ≥3 within 2 km)
   it answers on its own, for free. **Users can add masjids they know** («أضف مسجداً»); approved
   contributions join the same index, so Google's share shrinks as Iraq fills in.
3. **A persistent spend governor** (`places/budget.ts` + `places/governor.ts`) paces the remaining
   monthly allowance across the days left, holds 20% back for first-time clients, and divides the
   rest across the clients actually observed. Per-client caps are clamped to 2–10; a normal user
   generates 0–2 budget-consuming lookups a day, so the limit is invisible to them and decisive
   against a sweeper.
4. **Every request is recorded**, not only the ones that spend, so the governor paces on real
   active-client counts rather than a guess.
5. **The cell cache moved to Postgres** with a 30-day TTL and a hard DELETE prune, and the cell
   coarsened from ~330 m to ~1.1 km with the search anchored at the CELL CENTRE.

**Why the cache can coarsen without losing correctness.** A larger cell shares one call among more
people, but could hide a nearer masjid. `cellIsUsable` refuses any entry that cannot prove it does
not: either the search came back UNSATURATED (fewer results than the 20 requested, so it enumerated
everything within 5 km of the centre, and the user is at most a 0.72 km half-diagonal away), or it
saturated but its farthest result still reaches 1.5 km past the user. Anything else falls through to
a live search — which only happens in a very dense city centre, exactly where a fresh call is
warranted. Results are always re-ranked by distance from the user's ACTUAL position.

**Why the resident dataset is OpenStreetMap and not Google.** The obvious idea — pull every masjid in
Iraq from Google once and serve locally forever — is prohibited. Google Maps Platform ToS §3.2.3
permits caching a `place_id` indefinitely but other Places content for at most 30 days, and forbids
pre-fetching or mass collection to build a database. OSM's ODbL licence permits exactly this, and
users' own contributions are our data outright. Hence the split: `places_cache` holds Google content
under a real 30-day deletion, the resident index holds only data we may keep, and the two are merged
at SERVE time (`places/merge.ts`) rather than being written into each other. Contributions must be
the contributor's own knowledge — stated in the submission UI — or the dataset would be laundering
Google content and lose the very property that makes it durable.

**Why one unit cap covers two SKUs.** Spending is metered in UNITS: a live masjid search costs 1
(= 1 Places call), an on-expand travel lookup costs 2 (= 2 Routes elements). A unit is never cheaper
than the SKU it buys, so a single `PLACES_MONTHLY_UNIT_CAP` of 4500 bounds both free tiers at once
(≤4500 Places calls against 5000, ≤4500 Routes elements against 10000) whatever the mix.

**Relationship to earlier ADRs.** This supersedes ADR-011's rate-only breaker (kept, retuned to 1
unit per masjid miss, now the burst half of a two-part limit) and corrects ADR-009's claim that "the
grid cache keeps cost inside the free tier". It does NOT reverse the 2026-07-13 decision to reject
OSM as the PRIMARY source on quality grounds: cached Google content is still served in preference to
resident data, so quality already paid for is never discarded — resident data answers only where
nothing is cached and the local mapping is demonstrably dense.

**Also decided.** Fetch discipline on the client (user, 2026-07-25): the list is fetched once per
mount and thereafter only on pull-to-refresh — never on tab re-entry, never as the user moves.
Distances and bearings still track the live position; only the network call is pinned. A localStorage
copy (`prayer.masjids.v1`, 24 h fresh / 30 d retained) paints instantly and is the offline path.
Anonymous identity is a random `X-Client-Id` plus an IP PREFIX (/24 or /64) — enough to throttle,
never enough to identify, and no table links a client to a coordinate.

**Amendment (2026-08-26): the feature is Iraq-only.** The owner decided the nearest-masjid feature
serves Iraq only, and outside Iraq it is not offered at all. Rationale: the resident dataset is
Iraq-only (built for one Iraq bbox by `scripts/build-masjids.mjs`), so anywhere else would fall
straight through to metered Google with no free floor beneath it, exactly the ungoverned spend this
ADR exists to prevent, and the app's Play production launch is Iraq + the United States, where US
users are served qibla and prayer times but never the masjid feature. A shared bbox predicate
(`server/src/places/iraq-bbox.ts`, mirrored client-side as `client/src/lib/iraq-bbox.ts`) gates both
sides on `lat`/`lon`: the server geofences all three Places endpoints so a non-Iraq coordinate gets the
feature-disabled shape without touching Google, the resident index, or the DB, and the client hides the
whole section outside Iraq. bbox is the single source of truth (a location's country code is not
consulted). Full mechanism in `QIBLA_MASJID_SPEC.md` (2026-08-26 header note).

---

## ADR-015 — The operator dashboard is a separate bundle behind a password ✅

**Context (2026-07-26).** The app had no operator surface. Masjid contributions were moderated by
SSHing to the VPS and hand-writing `UPDATE masjid_contributions SET status='approved'`; failures
were found with `docker compose logs`; the Google spend was visible only through one token-gated
JSON endpoint; and there was no way to turn the paid feature off without a redeploy.

**Decision.** Build a dashboard at `/admin`, as a **second Vite application** (`client/admin` →
`client/dist-admin`), not a route inside the SPA.

**Why separate.** `capacitor.config.ts` sets `webDir: "dist"`, so everything in the SPA build is
packaged into the Android APK. A route there would ship operator code inside a distributable app.
Keeping it apart also keeps two opposite sets of conventions from bleeding: the app is Arabic, RTL
and has a four-theme engine; the dashboard is English, LTR and has one dark theme. The admin Vite
config deliberately omits `reusedEngineResolver()`, which makes the prayer engine *structurally*
unreachable from the dashboard rather than forbidden by a rule someone has to remember.

**Auth: stateless, one operator.** A scrypt digest in the env (`ADMIN_PASSWORD_HASH`) and an HMAC
cookie carrying a fingerprint of that digest, so **changing the password invalidates every
outstanding session** — the only revocation lever a single-operator tool needs, without a sessions
table. 12 h idle / 7 d absolute.

**Rejected: Traefik basic-auth.** It would have meant editing the shared proxy that also fronts the
other apps on this VPS, for a weaker result (no lockout, no audit, no session).

**Two orderings in `app.ts` are load-bearing**, and both fail silently, so `app.ts` finally has a
test: the admin API mounts *before* `cors({origin:true})` (and owns its whole subtree including
OPTIONS) so no cross-origin preflight can ever be approved for it; and `/admin` mounts *before* the
SPA history fallback, which would otherwise answer every admin URL with the prayer-times shell.

**Throttling has two layers**, because per-key alone bounds nothing here: `clientIpOf` trusts
`cf-connecting-ip`/`x-forwarded-for`, which anyone reaching the origin IP directly can rotate at
will. 5 failures/15 min locks a key; 50 failures/15 min across all keys locks logins entirely; and a
key that has logged in successfully is trusted for 30 days and bypasses the *global* lock, so an
attacker cannot use that backstop to keep the operator out of his own dashboard.

**Consequence.** One more thing to keep secure, and a password whose loss locks the operator out
until he edits the VPS `.env`. Accepted: everything the dashboard can do is otherwise done by hand
over SSH, which is not safer.

---

## ADR-016 — Audience telemetry: coarse, aggregate, and unlinkable across days ✅

**Context (2026-07-26).** The owner wanted to know how many people use the app, roughly where, and
what each anonymous client costs in Google units. The last of those was already recorded
(`places_usage`, ADR-014). The first two were not recorded at all: the codebase deliberately had no
analytics, and the privacy policy said so.

**Decision.** A once-a-day ping, with three properties chosen before any of the querying:

1. **Coordinates are rounded to ~1.1 km ON THE DEVICE** (`TELEMETRY_PRECISION_DEG = 0.01`), and the
   server clamps again — so a modified client cannot cause finer data to be stored than the privacy
   policy declares.
2. **The stored key is `HMAC(salt, day | clientId)`, with the day inside the message.** The same
   install therefore hashes differently every day and two stored rows cannot be linked. The raw
   client id is never written by this feature.
3. **The endpoint always answers `204`** — disabled, malformed, rate-limited, database down. An
   endpoint that reports server state is an endpoint that can be probed, and the client's only
   correct reaction to any failure is "try again tomorrow".

**The consequence is deliberate and binding on every reader:** cross-day uniques — real WAU/MAU —
are *uncomputable* from `usage_ping`. The API and the dashboard report averages of daily-active
counts, labelled "avg daily actives", and the Audience page explains why. A number that looked like
unique users but wasn't would be worse than no number.

**Rejected: precise per-user location trails.** Considered, because "see each user's points on a
map" was the original ask. It would have required declaring location as collected-and-retained, an
in-app prominent disclosure and consent flow under Play policy, and a real breach exposure — for
insight that a 1 km demand map already gives. The upgrade path is written down (add a `client_id`
column, set `loc_precision = 0`) precisely so that choosing it later is a deliberate, costed
decision rather than a config drift.

**Play/privacy consequences, shipped in the same release** (`PLAY_RELEASE.md`): approximate location
moves from "ephemeral" to retained; App interactions is newly declared; and **Device or other IDs is
corrected to "collected"** — the app has sent a persistent per-install `X-Client-Id` since ADR-014
and the old form denied it. The privacy policy also stops claiming nothing is retained server-side,
which was false for web push subscriptions.

**Also decided.** Notice is **privacy-policy-only** — no in-app opt-out switch (owner, 2026-07-26).
Defensible for a non-identifying aggregate count, but it forces the Data Safety answer to "required"
and leaves no way to honour an individual opt-out request. Revisit if that ever matters; it is a
~20-line change plus one Arabic string.

---

## ADR-017 — Full-year Waqf corpus, image-verified adjudication overlay, and year-recycle exact fallback ✅

**Context (2026-08-12).** The Iraqi calibration was fit against a **35-date** exact table, and on
dates that table missed, maghrib/isha still ran **±1–2 min** off the printed poster. The user supplied
a **366-day OCR archive** of the official cards (`server/data/waqf-times-2025-08-11-to-2026-08-11.json`)
plus the source poster JPGs, which makes a full-year fit and a genuine verbatim override possible —
but only if the OCR noise and the Waqf's own print defects are handled honestly, and only if dates
*after* the archive ends can still serve official numbers.

**Decision.**

1. **Provenance-filtered ingestion.** Each archive date carries a provenance. Only genuinely-official
   rows count as ground truth: **current-period** cards (keyed at the date) and **previous-year** cards
   (re-keyed to the date they were actually printed for). The **62 generated fill-in** rows are
   **skipped** — using formula output as ground truth would be circular. Merged with the original
   `_waqf_*.json` corpus + the 19-June poster → **321 verified dates × 15 govs**.
2. **A single audited adjudication overlay** (`server/data/waqf-archive-adjudications.json`), applied
   identically by the calibrator and the integrity-sweep `scripts/analyze-waqf-archive.ts`. The raw
   archive and `_waqf_*.json` files **stay pristine**; the overlay is the one record of what changed —
   **1199 archive + 23 old-corpus corrections** (three rounds of independent vision re-reads fixed the
   OCR pass's systematic +10-minute whole-row errors) and **2 excluded dates + 117 excluded cells**.
   Four lists (`excludedDates`, `corrections`, `excludedCells`, `oldCorpusCorrections`); exclusions are
   suppressed from **both** corpora so a defective value cannot re-enter via the old-corpus
   transcription of the same poster.
3. **Serve-verbatim-within-±5 / exclude-beyond policy for print defects.** A printed value within
   **±5 min** of the calibrated model is the official announcement and is served verbatim; **beyond
   ±5 min** it is a Waqf print defect (wrong-day cards, out-of-season/duplicated columns, two Baghdad
   hero misprints, truncations) and is **excluded** so the formula serves that cell.
4. **Year-recycle exact fallback** (`iraq-calibration-core.ts`). When `waqf-exact.json` has no entry
   for a date, the **same month-day up to 3 years back** is served verbatim (Feb-29 → Feb-28).
   Justified because the Waqf treats its table as **annual** (it reposted previous-year cards **41
   times** in the archived year) and same-Gregorian-date drift is **≤0.42 min**, so the recycled value
   is within ±1 min of the next poster; a **3-year cap** ages out a possible method change. Recycled
   values additionally skip, per-prayer, any cell whose printed value deviated ≥3 min from the model on
   the source date (the `noRecycle` map) — a one-day print oddity is served on its own date but never
   propagated to future years.

**Why.** A full year of genuine official data lets a per-gov **constant** be validated properly rather
than assumed; keeping the raw inputs pristine behind an audited overlay means the corrections are
reviewable and reversible; the ±5-min policy draws a principled line between "official rounding we must
honour" and "misprint we must not serve"; and the recycle fallback extends official coverage past the
archive without pretending to compute new posters.

**Consequences.**
- Validated (leave-one-**date**-out over the merged corpus): **85.8 % exact, 99.8 % within ±1 min**,
  worst per-gov ≤5 min (Baghdad ≤2); seasonal drift **0.26 min across the 46.9° span** confirms the
  per-gov constant is the right model with full-year data.
- Every covered date at a governorate capital serves poster numbers **verbatim**; dates within 3 years
  of a covered same-day serve **recycled** official numbers; everything else uses the formula.
- `waqf-exact.json` grew to **~900 KB** (321 dates × 15 govs) and is bundled into the native offline
  chunk; the recycle function is pure/browser-safe so the native app recycles offline too.
- The POSTER_0619 test anchor was corrected — **11** 1-minute transcription errors (re-verified at
  6–10× zoom against the byte-identical original photo), and the two long-documented "poster typos"
  (Basra maghrib, Amarah) were reattributed to **transcription**, not the poster.

See `PRAYER_ENGINE.md` §4 for the runtime detail and the poster-regression tolerances.
