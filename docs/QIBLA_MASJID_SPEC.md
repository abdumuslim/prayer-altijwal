# Qibla + Nearest-Masjid Spec — accurate direction, hosted in the Times tab

> **Status: BUILT 2026-07-14 (session 4) — all of QM1–QM5 implemented alongside v2 Phase 8.**
> As-built: `lib/qibla.ts` + reference-city tests · `GET /api/geo/declination` (WMM-2025 via the
> `geomagnetism` package — it DID carry the 2025 coefficients, no vendoring needed; NOAA
> test-vector snapshot tests) · `useCompassHeading` (native → web-absolute → iOS → static) ·
> `QiblaCompass` + `NearestMasjids` in a restructured Times tab (strip → qibla → masjids → month
> table DEMOTED into a collapsed `CollapsibleSection`, `useMonthTimes` gated on section-open) ·
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
  `X-Goog-Api-Key: <key>`,
  `X-Goog-FieldMask: places.id,places.displayName,places.location,places.shortFormattedAddress`,
  body `{ includedTypes: ["mosque"], maxResultCount: 10, rankPreference: "DISTANCE",
  languageCode: "ar", locationRestriction: { circle: { center: {latitude, longitude},
  radius: 5000 } } }`. 5 s timeout. Upstream error/timeout → `200 { enabled: true, masjids: [] }`
  + warn (client shows the error string, not a crash).
- Response mapping → `{ enabled: true, masjids: [{ id, name, lat, lon, address }] }` with
  `name = displayName.text` (Arabic when Google has it).
- **Cache**: in-memory Map keyed by lat/lon rounded to ~300 m grid, TTL 24 h, LRU-capped ~500
  entries — with the cap+cache this stays comfortably inside the Places free monthly tier
  (Nearby Search is a paid SKU; verify current pricing at implementation and set a GCP quota cap
  regardless, §8).
- Same public-API posture as the rest of `/api/*` (Cloudflare in front); note the endpoint in
  the security review before release.

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
