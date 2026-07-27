---
type: Spec
title: 'Qibla + Nearest-Masjid Spec — accurate direction, hosted in the Times tab'
description: 'Two features, both living in the Times tab (المواقيت), which the user wants repurposed (''the times tab content is not much useful, so use it for qibla and nearest masjid''):'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# Qibla + Nearest-Masjid Spec — accurate direction, hosted in the Times tab

> **Session 7 (2026-07-24, v2.1.2 / versionCode 7) — nearest-masjid "doesn't work" fix. BUILT (signed
> AAB), NOT yet field-verified.** A tester's Samsung (Galaxy A57, Play install, vc6) saw an error in
> the أقرب المساجد section. Live adb diagnosis **RULED OUT Samsung Auto Blocker** (the feature also
> works with Auto Blocker ON — the earlier "off → worked" was coincidental GPS warm-up; Auto Blocker
> only blocks *wireless adb*) and confirmed server proxy, location permission, and network all healthy.
> **Root cause: intermittent COLD-GPS-fix failure on first use** — the list gates on
> `location.source === "gps"`, and on a cold device (no cached fix, GNSS cold/indoors) BOTH staged-GPS
> timeouts expired → `source` never became `"gps"` → prompt + location error; it self-heals once any
> fix lands (hence "it works now"). **Fix (behaviour-only, NO new strings):**
> `client/src/lib/gps-staging.ts` (NEW, pure + unit-tested) — paint from the LAST KNOWN position first
> (`maximumAge` 5 min → 1 h), a **patient coarse fallback** (20 s) for a genuinely cold device, and a
> **SILENT precise refine** that never flashes an error over a list already painted;
> `hooks/useLocation.ts` `requestGps` now returns `Promise<boolean>` — a code-review **HIGH**: it never
> rejected (reports failures via UI state), so the staging's exception-based control flow was dead
> (patient fallback unreachable, refine always silent); `components/masjid/NearestMasjids.tsx` retries
> the fetch once (1.5 s) before showing «تعذّر…». Gates green: client build + engine gate + server 175
> + client 148 (incl. 4 new staging tests). Signed AAB (vc7) at
> `client/android/app/build/outputs/bundle/release/app-release.aab`. **OPEN:** user uploads to the
> closed/internal track (their login) + field-tests the cold-GPS case on the real device.
>
> **Session 6 (2026-07-22, v2.1.0 / versionCode 4) — feedback round 2, BUILT + DEPLOYED.**
> **Masjid rows redesigned:** the Maps/Waze chips left the row; tapping a row now EXPANDS it with a
> live Google **Maps Embed API** directions map (device → masjid, auto-fits both ends) and the two
> deep-link buttons underneath. Distance gained a travel-time subtext — walking + driving minutes
> from the **Routes API** (`computeRouteMatrix`, WALK and DRIVE are separate requests) — with proper
> Arabic number agreement (`دقيقة` / `دقيقتان` / `دقائق`, `minuteUnitKey()`). Long names scroll
> (`components/ui/MarqueeText.tsx`, only when they actually overflow; reduced-motion truncates).
> Expanding scrolls the panel clear of the tab-bar overlay (which `scrollIntoView` cannot do — the
> bar is `absolute`, so the row counts as "visible" underneath it).
> **Two keys now:** the Places key stays server-only; a SECOND browser-visible key restricted to the
> **Maps Embed API** (free, unmetered) is handed to the client in the `/api/places/masjids` response
> as `embedKey`. Missing ⇒ rows expand with the buttons and no map. Details + key values in
> `OPERATIONS.md`; rationale in `DECISIONS.md` ADR-013.
> **Cost shape:** Routes bills PER ELEMENT (origins × destinations), so the server prices only the 5
> rows the client renders, caches durations inside the same 24 h / ~300 m grid entry, and the
> ADR-011 breaker now charges **3 units per cache miss** (1 Places + 2 Routes) against 30/min.
> **Refresh (was: fetched once per position, then never again):** the list refetches on Times-tab
> re-entry and via a new pull-to-refresh (`components/ui/PullToRefresh.tsx` + the pure state machine
> in `lib/pull-to-refresh.ts` — it arms only at `scrollTop 0` and hands horizontal drags back to the
> pager). GPS is now **staged**: a fast cached/coarse fix paints the list within a second, then a
> high-accuracy fix refines in the background and only re-publishes if the ~300 m grid cell changed.
> With permission already granted the Times tab fixes itself — no button tap (verified on device:
> the list auto-loaded with real masjids at 73 m / 625 m / 891 m).
> **Compass fallback (the A21/A70 report):** `CompassPlugin` used TYPE_ROTATION_VECTOR *only* and
> hard-rejected when absent — a gyro-less budget phone therefore fell through to web sensor paths
> that don't exist in the WebView, leaving a static dial the user reads as "wrong". The chain is now
> ROTATION_VECTOR → GEOMAGNETIC_ROTATION_VECTOR → accel+magnetometer (low-passed, accuracy capped at
> "medium" — nothing stabilizes it), and every event carries `source`, surfaced in the 5-tap
> diagnostic. Still unverified on an actual gyro-less device.
> **Perf (the "laggy" report):** the heading stream left React state entirely — `useCompassHeading`
> now exposes `subscribe()`/`getHeading()` and the compass + masjid arrows drive transforms from one
> rAF loop, so the Times tab no longer re-rendered ~20×/s with a 200 ms CSS transition restarted
> every 50 ms on ~30 nodes. `lib/heading-anim.ts` holds the pure math (its tests caught a real
> seam bug: JS `%` on a drifted continuous angle returned −350° instead of +10°).

> **Session 5 (2026-07-19, v2.1.0) — APK feedback fixes:** (1) **Compass UI redesigned**
> (`QiblaCompass.tsx`): cardinal letters now stay UPRIGHT (glyph counter-rotated by `rot-angle`), a
> clear SVG **arrow needle** + Kaaba-at-tip replaces the mosque chip, the center degrees readout is
> REMOVED, larger dial, DEV-only heading diagnostic. **Auto-start**: `useCompassHeading` exposes
> `needsGesture` (true only iOS-web); TimesPage auto-starts when active + !needsGesture, so it starts
> itself and never re-prompts (button only iOS). Heading MATH is unchanged/canonical — any residual
> real-device offset is magnetometer calibration, not code. (2) **Nearest-masjid APK fix (root
> cause):** the WebView `navigator.geolocation` had NO permission → every fix failed silently.
> Installed `@capacitor/geolocation@8.2.0` (native branch in `lib/geolocation.ts`, dynamic import,
> own lazy chunk) + `ACCESS_FINE/COARSE_LOCATION` in the manifest; asks once (OS remembers); GPS
> denial now surfaces `error.locationDenied`/`error.location` in `NearestMasjids` (was swallowed).
> Times restructure: the today prayer STRIP was removed (compass is first now).
> **Round 2 (same day) — the real-Pixel "wrong direction" report:** `CompassPlugin.java` and the
> UI were re-audited against the canonical Android pipeline (rotation-vector matrix → per-rotation
> `remapCoordinateSystem` → azimuth → east-positive declination; rose `-rot`, needle `+bearing`,
> counter-rotations synced) — **no code defect found**. Remaining candidates are device-side
> (magnetometer calibration/interference) or a silent fall to STATIC mode. A hidden diagnostic was
> added: **5 quick taps on the qibla card title** toggle a `hdg · qibla · source · accuracy` line
> (always on in DEV) — `source` shows `native`/`web-absolute`/`web-ios` when live, or the bare
> status (e.g. `unavailable`) when the dial is static. Compare `hdg` against a trusted compass app
> to decide sensor vs code.
>
> **Round 3 — VERDICT (live adb/CDP session on the user's Pixel 7 Pro):** the code is correct; the
> DEVICE is magnetically compromised. Evidence: native heading and an independent
> `deviceorientationabsolute` path agreed within 1°; a full-circle rotation tracked smoothly
> 0→357°; presentation verified frame-exact (rose −rot, needle +bearing). `dumpsys sensorservice`
> showed the calibrated field at **171 µT vs Earth's ~47 µT** (X = −154 µT alone) with a
> **183 µT hard-iron bias** estimated by Android itself, and the rotation vector's per-event
> heading-uncertainty (values[4]) at **1.57 rad = ±90°** — while SENSOR_STATUS still said "high".
> **Fix shipped:** `CompassPlugin` now merges values[4] (≤5° high · ≤15° medium · ≤30° low · else
> unreliable) with the status callback, taking the WORSE — the UI on that phone now shows
> «بحاجة إلى معايرة» + the figure-8 hint instead of a false «دقة عالية». **Verification rule
> (user, saved to memory):** qibla direction must be judged against Kaaba GPS + the DEVICE's real
> GPS location — set the tester's true location first (the app was still on the Baghdad default).
>
> **Same-day additions (user requests):** (1) the masjid proxy now EXCLUDES non-mosque venues by
> name (`google-places.ts isExcludedVenue`, applied before the grid cache): husseiniya word forms
> حسينية/حسينيه/حسينيات/حسينة + Persian-script spellings (ی/ک folded to Arabic first) + Latin
> transliterations + موكب/مواكب + مضيف; Hussein-NAMED mosques/shrines are kept (regression test in
> `google-places.test.ts`; live-verified in Karbala city centre — deployed to prod). (2) the month
> table section on the Times tab is **open by default** (still gated on `active` so nothing fires
> off-tab).
>
> **Status: BUILT 2026-07-14 (session 4) — all of QM1–QM5 implemented alongside v2 Phase 8.**
> As-built: `lib/qibla.ts` + reference-city tests · `GET /api/geo/declination` (WMM-2025 via the
> `geomagnetism` package — it DID carry the 2025 coefficients, no vendoring needed; NOAA
> test-vector snapshot tests) · `useCompassHeading` (native → web-absolute → iOS → static) ·
> `QiblaCompass` + `NearestMasjids` in a restructured Times tab (strip → qibla → masjids → month
> table DEMOTED into a collapsed `CollapsibleSection`, `useMonthTimes` gated on section-open —
> **the month table was later REMOVED outright and the tab renamed «الاتجاهات» on 2026-07-23;
> this tab is now qibla + masjids only, see `docs/FRONTEND.md` §11**) ·
> `CompassPlugin.java` (ROTATION_VECTOR + GeomagneticField, display-rotation remap, `pulse()`
> haptic) · `server/src/places/` proxy per §6a (+`degraded: true` on upstream failure so the
> client can tell error from empty) · `StoredLocation.source` migration ("gps"|"search"|"default").
> Layout + all §7 strings user-approved 2026-07-14. **Live proxy VERIFIED 2026-07-14**: key
> received + stored (gitignored `server/.env` + `OPERATIONS.md`); first calls hit two GCP-side
> 403s — `SERVICE_DISABLED` (Places API (New) not enabled on the project) then
> `API_KEY_SERVICE_BLOCKED` (the key's API-restriction list predated the enablement) — both fixed
> by the user in the console; Baghdad + Mecca return real distance-ranked Arabic results (Mecca
> confirms per-place coordinates; the Baghdad CITY-CENTER point returns a cluster of user-pinned
> POIs sharing one coordinate — Google's data, not a mapping bug; real GPS fixes are fine).
> **Outstanding:** real-device compass accuracy (QM3 gate; emulator sensors are synthetic),
> Maps/Waze chooser check on the emulator, VPS `.env` entry at deploy (+ remove the user's home
> IP from the key allowlist after).

> **Moderation moved out of psql (2026-07-26).** Contributions are approved, rejected and corrected
> from the operator dashboard (`docs/ADMIN_DASHBOARD.md`), which also flags likely duplicates using
> the same `isSameMasjid` the serving path uses. An approval now takes effect **immediately** —
> `startCommunityRefresh` exposes `refreshNow()` and the route calls it — instead of waiting up to
> ten minutes for the poll. The poll remains the safety net for direct psql edits and for re-seeding
> after a restart. The spend data described in §6d is what the dashboard's Cost page reads.

## 1. Goal

Two features, both living in the **Times tab (المواقيت)**, which the user wants repurposed
("the times tab content is not much useful, so use it for qibla and nearest masjid"):

1. **Accurate Qibla direction** — a real compass pointing at the Kaaba that corrects for the
   three errors that make generic web qibla compasses wrong (relative sensors, no magnetic
   declination, no tilt compensation), tells the user how much to trust it, and **degrades to
   honest static guidance instead of a fake needle** when no absolute sensor exists.
2. **Nearest masjid** — a list of the closest mosques around the user's *real GPS* position
   (Google Places API, server-side proxied key) with distance, a live direction arrow, and
   one-tap navigation deep links into **Google Maps and Waze**.

## 2. Decisions already made — do NOT reopen

| # | Decision |
|---|---|
| Q1 | **Placement: the Times tab hosts both features** (user, 2026-07-13). Today's strip stays on top; the month table is demoted (collapsed/secondary — exact layout via live preview, §7). No 5th tab. |
| Q2 | **Masjid data = Google Places API (New)**, with a **new** Maps Platform API key (user choice over free OSM/Overpass — Iraq coverage). Key lives ONLY in the VPS `.env` behind a server proxy; the client never sees it. Key **missing ⇒ feature reports disabled and the client hides the section** — never a startup failure (it's an optional feature, not a required secret). |
| Q3 | **Accuracy is the point.** Native heading comes from the fused `ROTATION_VECTOR` sensor + Android's built-in `GeomagneticField` declination (true north, tilt-compensated, gyro-stabilized). Web is the fallback path: absolute orientation events + server-computed WMM declination. When neither exists → static guidance mode; **never animate a needle from non-absolute data**. |
| Q4 | Directions = **deep links** to Google Maps / Waze (no key, no SDK, no map render in-app). |
| Q5 | Nearest-masjid requires the user's **real GPS fix** (high-accuracy). Searching from the Baghdad default would mislead — the section shows a GPS opt-in prompt until a real fix exists. Qibla works from any resolved location (default included): bearing error from city-level position is <0.5°. |
| Q6 | Qibla bearing + distance are **pure client math** (`client/src/lib/qibla.ts`) — works identically web/native/offline, zero payload or native-chunk churn. Declination: **native = plugin** (GeomagneticField), **web = new `GET /api/geo/declination`** (server-side WMM lib), cached per location in localStorage (stale declination beats none — it moves ~0.1°/yr). |
| Q7 | The native plugin is a **new small app-local class** (`CompassPlugin`, own package) registered beside `PrayerAlarmPlugin` — do not bloat the alarm plugin. |
| Q8 | All v2/AGENTS hard rules hold: engine untouched + never in the web bundle, tz from the target location, zod at boundaries, no new client runtime deps (the WMM lib is **server**-side), every new Arabic string needs user approval before shipping (§7 table), Latin numerals. |

## 3. Why generic qibla compasses are inaccurate (the requirement)

1. **Relative orientation**: plain `deviceorientation` alpha has an arbitrary origin per page
   load and drifts — the needle is stable but points nowhere in particular.
2. **No magnetic declination**: magnetometers measure *magnetic* north; true north in Iraq is
   currently **~4–5° further east** (varies by location and year — hence a WMM model, not a
   constant).
3. **No tilt compensation**: raw alpha is only a compass heading when the phone is perfectly
   flat; at typical hand tilt the error reaches tens of degrees.
4. **No calibration/accuracy feedback**: near metal/magnets the magnetometer silently lies;
   generic apps show a confident needle anyway.

The design below addresses all four; the accuracy target is **±3° on a calibrated device**.

## 4. Architecture

```
                         ┌────────── useCompassHeading() ──────────┐
 native (Capacitor)      │ CompassPlugin (Java, ROTATION_VECTOR +   │
                         │ GeomagneticField) → true heading events  │
 web Android (Chrome/WV) │ deviceorientationabsolute → tilt-comp    │──► trueHeading, accuracy,
 web iOS (Safari/PWA)    │ webkitCompassHeading (+requestPermission)│    source
                         │  + declination from /api/geo/declination │
 no absolute sensor      │ → status "unavailable" (static mode)     │
                         └──────────────────────────────────────────┘
 client/src/lib/qibla.ts: KAABA const, bearingToKaaba(lat,lon), haversineKm  (pure, shared by both features)

 TimesPage: PrayerStrip (kept) · QiblaCompass card · NearestMasjids section · month table (demoted)

 server: GET /api/geo/declination?lat&lon      (WMM lib, zod, cached)
         GET /api/places/masjids?lat&lon       (Places proxy, zod, grid cache, key server-only)
```

## 5. Qibla implementation

### 5a. Math (`client/src/lib/qibla.ts` — new, pure)

- `KAABA = { lat: 21.422487, lon: 39.826206 }`.
- `bearingToKaaba(lat, lon)`: great-circle initial bearing
  `θ = atan2( sin Δλ, cos φ₁ · tan φ₂ − sin φ₁ · cos Δλ )` normalized to [0, 360). Baghdad
  sanity value ≈ **199.8°** (SSW). Implementation MUST add vitest cases with reference bearings
  for ~5 cities taken from a trusted source at build time (Accurate Times — the same tool that
  validated the Waqf calibration — or Google Qibla Finder), tolerance ±0.5°.
- `haversineKm(lat1, lon1, lat2, lon2)`: port of `server/src/util/geo-distance.ts` (client may
  not import server code; keep the same constants so values agree).
- Relative needle angle = `(bearing − trueHeading + 360) % 360`.

### 5b. Native heading — `CompassPlugin` (primary path, the accuracy ask)

New app-local plugin, `client/android/app/src/main/java/com/altijwal/prayer/compass/CompassPlugin.java`
(`@CapacitorPlugin(name = "Compass")`), registered in `MainActivity` beside `PrayerAlarmPlugin`:

- `start({ lat, lon, alt })`: register `TYPE_ROTATION_VECTOR` at `SENSOR_DELAY_GAME`;
  per event: `getRotationMatrixFromVector` → `remapCoordinateSystem` for the current display
  rotation → `getOrientation` → azimuth (rad→deg, normalize). Add declination from
  `new GeomagneticField(lat, lon, alt, now).getDeclination()` (Android's built-in WMM — no
  library). Emit throttled (~20 Hz) `heading` events:
  `{ trueHeading, magneticHeading, declination, accuracy }` where accuracy maps
  `SensorManager.SENSOR_STATUS_*` → `high | medium | low | unreliable`.
- `stop()`: unregister. Plugin also unregisters in `handleOnPause()` and re-registers in
  `handleOnResume()` if it was active (battery).
- No new manifest permissions (sensors need none).
- `client/src/lib/native.ts`: `Compass = registerPlugin<CompassPlugin>("Compass")` + types,
  same pattern as `PrayerAlarm`.

### 5c. Web heading (fallback path)

In priority order inside the hook:

1. **`isNative()`** → plugin (§5b).
2. **`"ondeviceorientationabsolute" in window`** (Android Chrome; secure context required) →
   listen `deviceorientationabsolute`; derive the tilt-compensated compass heading from the
   α/β/γ rotation matrix (the standard W3C-example formula — NOT raw `360 − alpha`), correct by
   `screen.orientation.angle`, then add declination.
3. **iOS Safari/PWA** → `DeviceOrientationEvent.requestPermission()` (MUST be called from the
   tap on «ابدأ البوصلة» — it throws outside a user gesture), then `deviceorientation` with
   `webkitCompassHeading` (already tilt-compensated, magnetic) + declination;
   `webkitCompassAccuracy` → the accuracy chip.
4. **Neither** (denied / desktop / no sensors) → `status: "unavailable"` → static mode (§5e).

Declination for paths 2–3: `GET /api/geo/declination?lat&lon` → `{ declinationDeg }`, computed
server-side with a WMM library (use `geomagnetism` if it carries WMM-2025 coefficients at
implementation time; otherwise vendor the official WMM-2025 `.COF` + a small evaluator — target
±0.5°). zod-validate lat/lon; result cached client-side in localStorage keyed by ~10 km rounded
location (declination changes slowly in space and time; offline reuse is fine).

Smoothing (web paths): exponential smoothing on the unit circle (average sin/cos, `atan2` back,
~150–250 ms window) — prevents jitter without visible lag. The native fused sensor needs at most
light smoothing.

### 5d. Hook contract — `client/src/hooks/useCompassHeading.ts`

```ts
interface CompassState {
  status: "idle" | "starting" | "active" | "unavailable" | "denied";
  trueHeading: number | null;      // deg CW from TRUE north, smoothed
  accuracy: "high" | "medium" | "low" | "unreliable" | null;
  source: "native" | "web-absolute" | "web-ios" | null;
}
// start()/stop(); auto-stop when TimesPage loses `active` (keep-mounted tabs!) — sensors must
// not run while the user sits on another tab.
```

### 5e. Compass UI — `client/src/components/qibla/QiblaCompass.tsx`

- Card with a compass face: rotating rose (heading), fixed phone-up marker, **Kaaba marker** at
  the relative qibla angle; numeric bearing («القبلة: 199°») + distance («1,394 كم» — Latin
  digits); cardinal letters.
- **Lock-on at ±3°**: needle/ring highlights (gold), subtle haptic on native
  (`View.performHapticFeedback`, no permission), `aria-live` announcement.
- **Accuracy chip** (high/medium/low) + **calibration prompt** (figure-8 animation + string) when
  `low | unreliable`.
- **Level bubble**: from β/γ (web) — encourage holding flat; iOS `webkitCompassHeading` and the
  native path are tilt-tolerant, so this is a hint, not a gate.
- **Static mode** (`unavailable`/`denied`): fixed compass-rose graphic with the qibla arrow drawn
  at its true bearing from north + instruction «وجّه أعلى الهاتف نحو الشمال ثم اتبع السهم» +
  bearing/distance numbers. No animation.
- Theme via semantic tokens/surface classes only (all 4 themes must pass the contrast gate);
  `prefers-reduced-motion`: needle snaps (no spring), figure-8 animation replaced by text.

## 6. Nearest masjid

### 6a. Server proxy — `GET /api/places/masjids?lat=&lon=`

New `server/src/places/` (router factory pattern like `geo/routes.ts`; template:
`open-meteo.ts` — AbortController timeout, defensive coercion, `childLogger("places")`, never
throws):

- zod: lat ∈ [−90, 90], lon ∈ [−180, 180] (400 on failure, no detail leaks).
- No `GOOGLE_MAPS_API_KEY` in env → `200 { enabled: false, masjids: [] }` (+ one startup
  `log.warn`). Client hides the section.
- Upstream: `POST https://places.googleapis.com/v1/places:searchNearby`, headers
  <!-- okf-allow: `<key>` is a placeholder, not a value -->
  `X-Goog-Api-Key: <key>`,
  `X-Goog-FieldMask: places.id,places.displayName,places.location,places.shortFormattedAddress`,
  body `{ includedTypes: ["mosque"], maxResultCount: 10, rankPreference: "DISTANCE",
  languageCode: "ar", locationRestriction: { circle: { center: {latitude, longitude},
  radius: 5000 } } }`. 5 s timeout. Upstream error/timeout → `200 { enabled: true, masjids: [] }`
  + warn (client shows the error string, not a crash).
- Response mapping → `{ enabled: true, masjids: [{ id, name, lat, lon, address }] }` with
  `name = displayName.text` (Arabic when Google has it).
- Same public-API posture as the rest of `/api/*` (Cloudflare in front); note the endpoint in
  the security review before release.

> ⚠️ **Superseded in part by ADR-014 (2026-07-25).** `maxResultCount` is now **20**, the search is
> anchored at the **cell centre** (not the caller), the cache is **Postgres-backed with a 30-day
> TTL**, travel times are **no longer fetched for the list**, and a resident OpenStreetMap dataset
> answers first where it is dense. See §6d below — it is authoritative where it disagrees with the
> bullets above.

### 6d. Quota architecture (ADR-014, 2026-07-25) — AUTHORITATIVE

**Why it changed.** The walk/drive times, not the masjid search, were setting the ceiling: each cache
miss cost 1 Places call (Nearby Search **Pro**, 5,000 free/month) *plus* 10 Routes elements (Compute
Route Matrix **Essentials**, 10,000 free/month), so Routes ran out five times sooner and capped the
feature at ~1,000 lookups/month.

**Serving order** for `GET /api/places/masjids` — first hit wins:

| # | Source | Cost | Module |
|---|---|---|---|
| 0 | client localStorage (`prayer.masjids.v1`) | no request at all | `client/src/lib/masjid-cache.ts` |
| 1 | memory cell (1 h) → Postgres cell (≤30 d) | 0 | `places/cache.ts`, `db/repositories/places-cache.ts` |
| 2 | resident index, **when dense here** | 0 | `places/resident-index.ts` |
| 3 | live Google, if the governor admits | 1 unit | `places/masjid-service.ts` |
| 4 | resident / stale cache + `degraded: true` | 0 | — |

Cache **before** resident on purpose: quality already paid for is never discarded in favour of a
free-but-thinner answer. "Dense here" = ≥1 resident masjid within 1 km AND ≥3 within 2 km.
Google and resident results are **merged** (`places/merge.ts`), never swapped — resident names win,
Google's `place_id` is adopted for the deep link.

**Cell geometry.** `CELL_DEG = 0.01` (~1.1 km; half-diagonal ~0.72 km at Baghdad's latitude),
`MAX_RESULTS = 20`, search anchored at the cell centre so one call serves the whole cell. A cached
cell is served only when `cellIsUsable` proves it cannot hide a nearer masjid: unsaturated
(`resultCount < 20` ⇒ the 5 km search was exhaustive) **or** `maxDistKm ≥ distanceFromCentre + 1.5`.
Results are re-ranked by distance from the user's ACTUAL position.

**Travel times.** The list carries a free estimate (`places/travel-estimate.ts`) labelled «نحو …».
`GET /api/places/travel?lat&lon&dlat&dlon` buys the real figure for ONE masjid when a row is
expanded (2 elements, cached 24 h). Failure ⇒ `degraded: true` and the client keeps its estimate.

**Spend governor** (`places/budget.ts` pure math + `places/governor.ts`). Units: masjid search = 1,
travel lookup = 2. Month boundary is **America/Los_Angeles** (Google resets midnight PT on the 1st).

```
dailyPool     = max(1, floor((cap − usedThisPtMonth) / daysLeftInPtMonth))
reserve       = ceil(0.2 × dailyPool)          // first-time clients only
perClientCap  = clamp(round((dailyPool − reserve) / activeClients), 2, 10)
perIpCap      = 3 × perClientCap
```

Admission: burst breaker (ADR-011, 30 units/min) → global pool → per-client → per-IP. The per-client
increment is guarded **inside a single SQL statement**, so concurrent requests cannot both pass a cap
they both read as clear. A denial is not an error — it falls to step 4.

**Telemetry.** EVERY request is recorded, not only paid ones, so `activeClients` is real:
`places_usage` (per PT day × client/ip: requests + spend, written synchronously because it gates
spending), `places_stats` (hourly outcome rollup) and `places_cell_demand` (which cells cost live
calls → where contributed masjids would pay off), both buffered and flushed every 15 s. No table
links a client id to a coordinate. IPs are stored only as a /24 or /64 **prefix**.
`GET /api/places/usage?token=…` reports the live plan (404 unless `ADMIN_TOKEN` is set).

**Resident dataset.** `npm run build:masjids` → `server/data/masjids-iq.json` from OpenStreetMap via
Overpass (tiled 8×8 over an Iraq bbox, each tile cached under `data/_raw/masjid-tiles/` so a rerun
resumes; a tile the servers refuse is automatically SPLIT into quarters, because a timeout on dense
Baghdad/Mosul is about data volume and retrying the same query never converges).

*As built (2026-07-25): **9,835 rows, 817 KiB**; 9,731 survive the venue filter at load. Measured
coverage — Karrada 18 masjids within 5 km (nearest 413 m), Adhamiya 44 (nearest 330 m — correctly
جامع أبو حنيفة النعمان), Mosul 117, Erbil 299, Basra 56, Karbala 61. `isDenseAt` is true for every
major city centre and false for Najaf centre (nearest 1.5 km) and open desert, which correctly fall
through to Google.*
A descriptive `User-Agent` is REQUIRED — without it the instances answer 406 at the web-server layer.
Venue exclusion (husseiniya/mawkib/mudhif) is applied at LOAD time via the shared
`places/venue-filter.ts`, so the OSM and Google paths can never drift apart.
**ODbL requires visible attribution** — rendered under the list as «بيانات المساجد: OpenStreetMap
ومساهمو التطبيق».

**Contributions.** `POST /api/places/masjids/contribute` `{ name, lat, lon, userLat, userLon }` →
`masjid_contributions` as `pending`; 5/day/client; rejected beyond 50 km from the submitter (a guard
against a mis-dropped pin, not a security control). Approved rows join the resident index within
10 minutes (`places/community-refresh.ts`). The contributor sees their own submission immediately
from their **own device's** copy (`client/src/lib/my-masjids.ts`), so no unreviewed text is ever
served to anyone else. Moderation is `psql` — see `docs/OPERATIONS.md`.

> **Legal boundary that shapes all of the above.** Google Maps Platform ToS §3.2.3 allows caching a
> `place_id` indefinitely but other Places content for at most 30 days, and forbids pre-fetching or
> mass collection to build a database. So `places_cache` is Google-only under a real DELETE at 30
> days, the resident index holds only ODbL + our own users' data, and the two are merged at serve
> time — never written into each other. Contributions must be the contributor's own knowledge.

### 6b. Client — `client/src/components/masjid/NearestMasjids.tsx`

- Gate: until `location` came from a real GPS fix (track `source: "gps" | "search" | "default"`
  on `StoredLocation` — small additive migration in `storage.ts`), show the opt-in prompt
  «لإيجاد أقرب المساجد فعّل تحديد موقعك الدقيق» + button reusing `useLocation.requestGps()` with
  a **high-accuracy** variant (`getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0 })`
  — the existing wrapper already accepts overrides).
- List (top ~5): `MosqueIcon` + name + distance (`haversineKm`, "850 م" / "1.2 كم", Latin
  digits) + a small bearing arrow per row, live-rotating when the compass is active (reuses
  `useCompassHeading` state; static bearing-from-north otherwise).
- Row actions: **خرائط Google** → `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lon>&destination_place_id=<id>`
  · **Waze** → `https://waze.com/ul?ll=<lat>,<lon>&navigate=yes`. Plain
  `<a target="_blank" rel="noopener">` — Capacitor sends external hosts to the system (app
  chooser). If the WebView swallows it on the emulator, fall back to `@capacitor/app-launcher`
  (tiny official plugin; native-only import).
- States: loading skeleton · empty («لا توجد مساجد قريبة ضمن 5 كم») · error («تعذّر جلب المساجد
  القريبة») · hidden entirely when `enabled: false`.
- `client/src/lib/api.ts` + `types/api.ts`: `fetchNearbyMasjids(lat, lon)` + response types.
  Native uses the same endpoint (masjid search is online-only by nature — directions need
  connectivity anyway); offline native → section shows the error/empty state, times/qibla remain
  fully functional.

## 7. Times-tab restructure (iterate LIVE — user's preview loop)

Proposed order (top→bottom): **today strip (kept)** → **QiblaCompass card** → **NearestMasjids**
→ **month table inside a collapsed `CollapsibleSection` («الجدول الشهري», default closed;
`useMonthTimes` already lazy — wire its `active` to section-open so no request fires while
closed)**. Tab keeps the name «المواقيت» unless the user renames it during preview. Present 2–3
layout variants live before building final; screenshot per theme × 390/360 after.

**New AR strings (D7 — user approval BEFORE shipping; propose during the preview round):**

| Key | Proposed AR |
|---|---|
| `qibla.title` | «اتجاه القبلة» |
| `qibla.start` | «ابدأ البوصلة» |
| `qibla.distance` | «المسافة إلى الكعبة» |
| `qibla.aligned` | «أنت باتجاه القبلة» |
| `qibla.calibrate` | «حرّك الهاتف على شكل 8 لمعايرة البوصلة» |
| `qibla.holdFlat` | «أمسك الهاتف أفقيًا» |
| `qibla.static` | «وجّه أعلى الهاتف نحو الشمال ثم اتبع السهم» |
| `qibla.permission` | «اسمح بالوصول إلى حساسات الحركة» |
| `masjid.title` | «أقرب المساجد» |
| `masjid.gpsPrompt` | «لإيجاد أقرب المساجد فعّل تحديد موقعك الدقيق» |
| `masjid.gpsButton` | «استخدام موقعي» |
| `masjid.none` | «لا توجد مساجد قريبة ضمن 5 كم» |
| `masjid.error` | «تعذّر جلب المساجد القريبة» |
| `masjid.maps` / `masjid.waze` | «خرائط Google» · «Waze» |
| `times.monthCollapsed` | «الجدول الشهري» (existing `times.monthTitle` may be reused) |

Every key mirrors into `strings.en.ts` (the `StringKey` source of truth).

## 8. GCP setup (user steps) — DONE + LIVE 2026-07-14; the key is on prod

1. console.cloud.google.com → pick a project → **enable "Places API (New)"** → billing must be
   enabled on the project.
2. Credentials → **Create API key** → restrict it: *API restriction* = Places API (New) only;
   *Application restriction* = the VPS's public IP (in `docs/OPERATIONS.md` — do NOT write it
   here; this file is committed).
3. Quotas → set a daily cap (e.g. 500 requests/day) as a cost fuse. (Backed in code by the
   per-minute upstream breaker — ADR-011.)
4. Put the key in the VPS `/opt/prayer` `.env` as `GOOGLE_MAPS_API_KEY=…`; record it in
   `docs/OPERATIONS.md` (gitignored) and add the env var *name* to `docs/DEPLOYMENT.md`'s env
   table. Never in the repo.

> **ONBOARDING GOTCHAS (hit both, 2026-07-14 — order matters):** the key surfaced two sequential
> `403`s before it worked. (a) `SERVICE_DISABLED` — Places API (New) wasn't enabled on the
> project yet (do step 1 first; allow a few minutes to propagate). (b) `API_KEY_SERVICE_BLOCKED`
> — the API only appears in the key's *API-restriction* picker **after** it is enabled, so a key
> created before enabling has an empty/stale restriction list that blocks the call; go back to the
> key and tick "Places API (New)". Read the raw upstream body to tell these apart — the server
> proxy collapses both to `degraded:true` by design. Beware the legacy "Places API" entry in the
> picker: it is NOT the same as "Places API (New)". **Post-deploy follow-up owed:** the user's
> home IP was added to the allowlist for local testing — remove it, leaving only the VPS IP.

## 9. Phases + gates

Standard gates for every phase: `cd client && npm run build` (the ONLY valid client typecheck) ·
`cd server && npm test` · engine gate `grep -l astronomy client/dist/assets/*.js` lists only
`api-*.js` · phases touching android: `cd client/android && ./gradlew.bat assembleDebug`.

- **QM1 — math + declination endpoint.** `lib/qibla.ts` + vitest reference-city cases;
  `/api/geo/declination` (WMM lib, zod, tests incl. a known declination snapshot ±0.5°).
- **QM2 — web compass.** `useCompassHeading` (web paths + static fallback) + `QiblaCompass` in
  TimesPage; live design iteration with the user. Manual device test — note: orientation events
  need a **secure context** (deploy preview or `adb reverse` localhost).
- **QM3 — native plugin.** `CompassPlugin.java` + hook native path. Verify on a **real device**
  (the emulator's virtual magnetometer/rotation is synthetic — use it only for lifecycle, not
  accuracy); check plugin stops when tab inactive/app paused.
- **QM4 — masjid.** Server proxy (+ tests with mocked `fetch`: happy, timeout, bad JSON, no-key
  disabled mode) → client section + deep links (emulator: links open the Maps/Waze chooser) →
  `StoredLocation.source` migration.
- **QM5 — restructure + polish.** §7 layout via live preview, strings approval, a11y (compass
  has text alternatives; `aria-live` on lock-on), screenshots all themes × 390×844 + 360×740,
  security-review pass over the new endpoints, docs updates (`FRONTEND.md` §Times tab,
  `PRAYER_TIMES_API.md` new endpoints, `DEPLOYMENT.md` env, `DECISIONS.md` ADR).

## 10. Risks / notes

- **Emulator compass is fake** — accuracy claims are only testable on hardware (QM3 gate).
- iOS (web/PWA only — no native iOS yet): `requestPermission` must be user-gesture-triggered;
  some iOS PWA contexts historically flaky with orientation events → static mode is the safety
  net everywhere.
- Places pricing/SKU tiers change; three layers bound cost: the grid cache (organic dedup), the
  **per-minute upstream budget breaker** (ADR-011 — bounds adversarial coordinate-sweeps the cache
  can't), and the GCP-side daily quota cap (hard billing backstop). If cost ever matters, an
  OSM/Overpass fallback (`amenity=place_of_worship` + `religion=muslim`) can be added behind the
  same proxy contract (rejected as primary for Iraq coverage, user 2026-07-13).
- `displayName` may come back non-Arabic for some POIs despite `languageCode: "ar"` — render
  as-is (names are proper nouns; the Latin-numerals rule is unaffected).
- **Places DATA QUALITY varies by point:** a Baghdad city-CENTER query returned a cluster of
  user-pinned POIs sharing one coordinate (Google's data there, not a bug — Mecca returns correct
  per-place coordinates). Real GPS fixes are fine; don't chase this as a mapping defect.
- Keep-mounted tabs: sensors and the masjid fetch must key off TimesPage's `active` prop —
  nothing may poll while the tab is hidden (battery + quota).
