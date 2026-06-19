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

## ADR-002 — Calculation method: auto-detect by location + manual picker ✅ ⚠️

**Decision.** Default the calculation method by the user's **location** (country/city → the official
method for that place); expose a **manual picker** (all 13 presets + Asr Standard/Hanafi) that
overrides and is remembered in `localStorage`.

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

**⚠️ BaghdadYMA-offset nuance (must respect).** `BaghdadYMA` is MWL angles (Fajr 18° / Isha 17°,
Standard Asr) **plus Baghdad-specific calibration**: `+5` Dhuhr, `+3` Asr, `+2` Maghrib minute
offsets and a fixed 34 m elevation, tuned to match Baghdad's *printed* calendar (≤1 min over 38
dates). Those offsets encode Baghdad's local convention — they are **not** a universal Iraqi rule.

Policy: apply the full `BaghdadYMA` profile (with offsets) **only when the resolved location is
Baghdad** (or within a small radius). For other Iraqi cities, use its **angles without the offsets**
(effectively MWL 18/17, Standard Asr, with the city's own elevation from the dataset). Surface which
is active in the UI ("Iraqi Sunni Endowment — Baghdad calibration" vs "MWL angles"). Detail in
`PRAYER_ENGINE.md`.

**Why.** Iraqi users expect times matching their local mosque/printed calendar; nationally-correct
defaults beat a single global method, while the picker covers travellers and differing madhāhib.

**Consequences.** Needs a country (and ideally city) resolver from GPS — see `GEOCODING.md`. The
method-detection table and the Baghdad-radius rule live in a small server module.

---

## ADR-003 — MVP feature scope ✅ 🔭

**Decision.** First version ships:
- **Core:** today's six times (Fajr, Sunrise, Dhuhr, Asr, Maghrib, Isha) + a live **next-prayer
  countdown** + **Hijri date** + **next Islamic event**.
- **Web-push reminders** — browser notifications ahead of each prayer (`NOTIFICATIONS.md`).
- **Manual location / city search** — override GPS by searching a city; remembered (`GEOCODING.md`,
  `FRONTEND.md`).

🔭 **Deferred (future, documented hooks only):** Qibla compass, monthly times table.

**Why.** Matches the user's selection. Notifications + city-search are the two features that change
the architecture (backend + DB + geocoding), so they are scoped in deliberately; Qibla/monthly are
cheap, additive, and can land later without rework.

**Consequences.** Requires a `prayer` PostgreSQL database for push subscriptions and a server-side
scheduler. The core app (everything except push) is independently shippable first.

---

## ADR-004 — Localization: bilingual AR/EN, Arabic default, RTL ✅

**Decision.** Bilingual Arabic/English with a toggle. **Arabic is the default**; layout is
**RTL-aware** (switch `dir`/`lang` on the root, use CSS logical properties). Choice persisted.

**Why.** The audience is Iraq-centric (via altijwal.com); Arabic-first serves them best while English
keeps the app broadly usable.

**Consequences.** A lightweight in-house i18n layer (two flat dictionaries, a `t()` lookup — no heavy
library), RTL-safe styling, and a decision on Arabic-Indic vs Latin numerals in time strings (pick
one consistently). Detail in `FRONTEND.md`.

---

## ADR-005 — Documentation system: home's 3-tier "PC storage levels" ✅

**Decision.** Mirror the home project's tiered docs: **Tier 1** always-loaded routers (`AGENTS.md`
committed + `CLAUDE.md` local-only) → **Tier 2** lightweight C-drive memory (feedback/prefs/
credentials + routing index, *no architecture knowledge*) → **Tier 3** `docs/*.md` loaded on demand.

**Why.** Keeps the most-needed info in-context and losslessly compressed, with full detail one hop
away — the user's stated "CPU cache / RAM / SSD" principle. Keeps institutional knowledge across
sessions. See `MEMORY.md` and the Tier-1 routers.
