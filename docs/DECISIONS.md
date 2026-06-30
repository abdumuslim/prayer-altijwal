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
  otherwise. Purely informative; not configurable.
- **Iqama countdown bar** — appears between a prayer's adhan and its iqama; per-prayer adhan→iqama
  minutes are **user-configurable** in Settings (localStorage `iqamaMinutes`, defaults Fajr 25 /
  Dhuhr 15 / Asr 15 / Maghrib 5 / Isha 10; sunrise excluded). **Bar colour uses the absolute
  proximity palette** (15/10/5/1 min to iqama), same as the hero ring — chosen over a
  progress-relative scheme so "within 5 min = red" holds (Maghrib's 5-min window is red throughout;
  Isha orange→red; Fajr walks the full palette). The main ring + name + countdown were shrunk one
  step (224→208, etc.) to make room.

🔭 **Deferred (future, documented hooks only):** Qibla compass, monthly times table.

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
