---
type: Runbook
title: 'Play Store Release Runbook — مواقيت الصلاة (com.altijwal.prayer)'
description: '1. play.google.com/console → pick مواقيت الصلاة. 2. Left nav: Test and release → Testing → Closed testing → open your existing track (the one your 12 testers are already on) → Create new release. 3. Under App bundles,…'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# Play Store Release Runbook — مواقيت الصلاة (`com.altijwal.prayer`)

> **Self-sufficient publishing guide** (researched against Google's requirements as of 2026-07-11 —
> source links inline). Follow top to bottom; every Console question has its exact answer for THIS
> app. Secrets (keystore path/passwords) go in `docs/OPERATIONS.md` (gitignored) — NEVER in the repo.
>
> **Realistic end-to-end timeline: ~3–4 weeks.** 14 days closed testing (hard requirement for new
> personal accounts) + ≤7 days production-access review + 1–7 days first-app review.

## App identity (fixed values — copy-paste)

| Field | Value |
|---|---|
| Package / applicationId | `com.altijwal.prayer` ⚠ immutable after first upload |
| App name (store + launcher) | `مواقيت الصلاة` |
| Default store language | Arabic — `ar` |
| Category | App → Lifestyle |
| Price | Free (never reversible to paid) |
| Website | `https://prayer.altijwal.com` |
| Contact email | `contact@al-tijwal.com` (verified + shown publicly) |
| First release | `versionCode 1`, `versionName "1.0"` (`client/android/app/build.gradle`) |

---

## Update runbook — ship a new version to the current testing track (repeatable)

> **This is the common path now.** Phases 0–4 below (account, signing, store listing, privacy,
> data-safety, permission declarations) are **one-time and already done** — you only revisit them if
> something structural changes. To push an update you do just this section. Everything the Console
> asks that isn't covered here keeps its Phase-4 answer.

> **Current status (2026-08-26).** **v2.5.0 / versionCode 11** cleared review and is **live** on the
> **Open testing** track (published 25 Aug; countries **Iraq + United States**, plus **Jordan** sent
> for review 2026-10-19). **v2.6.0 /
> versionCode 12** (the production-hardening round + Iraq-only masjids) was **sent for review
> 2026-08-26**; the same day the updated store listing descriptions went in for review. Production
> has **not** been released yet (§①d checklist). **The next bump is versionCode 13**, deploy target
> **Open testing**. §⓪ below documents the earlier **v2.4.0** round and is kept for reference only.

### ⓪ Reference: the v2.4.0 round (superseded by v2.5.0/vc11)

- **Signed bundle:** `D:\keys\releases\prayer-v2.4.0-vc10.aab` — versionName **2.4.0**, versionCode
  **10**, signed with the upload key (`prayer-upload.jks`). Built + verified 2026-08-12
  (`META-INF/UPLOAD.RSA` present in the AAB); upload this file as-is.
- **What changed:**
  - **Prayer times at every Iraqi governorate capital now match the official ديوان الوقف السني poster
    to the minute across the whole year.** The app ships the full 2025-08→2026-08 official table (every
    cell image-verified against the year's poster photos), and dates beyond it reuse the same calendar
    day from the most recent covered year (the Waqf's own practice when it misses a day) — removing the
    ±1–2-minute maghrib/isha drift on dates the old 35-date table didn't cover. Genuine misprints in
    ~30 official cards (wrong-day tables, shifted/duplicated columns, two Baghdad hero typos) are
    detected and never served; eleven 1-minute transcription errors in the 19-June-2026 reference
    poster were also found and fixed. Audit trail: `server/data/waqf-archive-adjudications.json`,
    `docs/DECISIONS.md` ADR-017, `CHANGELOG.md` §2.4.0.
  - **The «أقرب المساجد» directions preview no longer shows a raw Google error** for a masjid whose
    Google listing changed — the preview now always targets the masjid's coordinates.
- **The web half is already deployed to prod (2026-08-12)** — this Play update ships the same fixes to
  the app testers.
- versionCode 10 > every previously uploaded code (1–9) → Play accepts it.
- Gate before upload (all green 2026-08-12): `npm run build` · **177** client tests · **414** server
  tests · `findstr /m astronomy client\dist\assets\*.js` → only `api-*.js` · `META-INF/UPLOAD.RSA` in
  the AAB.

### ① Upload to the closed track (Play Console — your login)

1. **play.google.com/console** → pick **مواقيت الصلاة**.
2. Left nav: **Test and release → Testing → Closed testing** → open your existing track (the one your
   12 testers are already on) → **Create new release**.
3. Under **App bundles**, **Upload** the bundle named in ⓪ (now `prayer-v2.1.2-vc7.aab`). Play App Signing is already on — it
   re-signs with the app key automatically; nothing to configure.
4. **Release name** auto-fills from the bundle (now `7 (2.1.2)`) — leave it.
5. **Release notes** — paste the AR text from ② inside the `<ar-XB>`/`ar` language block (or the
   single notes box). **← get my sign-off on the wording first (user-visible text rule).**
6. **Next → Save**, then **Review release**. Resolve any warnings (a new permission would re-open a
   Phase-4 declaration — this release adds none, so none should appear). **Start rollout to Closed
   testing** → confirm.

### ①b The «deploy» command — Claude publishes via Chrome (verified end-to-end 2026-07-24, v2.1.2/vc7)

When the user says **"deploy"**, this is the process (assumes ⓪'s signed AAB is built + archived).
The user must be signed into Play Console in **their own Chrome** — the `claude-in-chrome` extension
drives their authenticated session (Playwright would be a fresh, logged-out session). The exact
click-path that worked:

1. `navigate` → `https://play.google.com/console` → **Choose developer account** → click **AL-Tijwal**.
   ⚠ Use the `find` tool for the row, not raw coordinates — a mis-click lands on "Create a new
   developer account" / the signup flow (`/console/u/0/signup`); if that happens, `navigate` **back**.
2. App list → open **مواقيت الصلاة** (`com.altijwal.prayer`; app URL is `.../app/4975799181636642377/`).
3. Left nav **Test and release → Testing → Closed testing** → open the **Alpha** track
   (`.../tracks/4697740499076933696`) → **Create new release** (top-right).
4. **Upload the bundle — THIS STEP IS THE USER'S, not automatable.** The `file_upload` tool can't do
   it: the AAB is ~12 MB (tool caps at **10 MB**) AND lives in `D:\keys\releases\` (outside the
   session's readable folders). Hand off explicitly: "drag `prayer-vX.Y.Z-vcN.aab` into the *Drop app
   bundles here* zone (or click Upload and pick it)." Then wait for their confirmation.
5. Release name auto-fills `N (X.Y.Z)` — leave it. The previous vc drops to **"Not included"**
   (correct — the new build supersedes it).
6. **Release notes** — the field pre-fills `<ar>…</ar>` tags. Click in → `ctrl+a` → `type` the whole
   block **including the tags**. **⚠ Get the AR wording user-approved FIRST** (user-visible text rule;
   propose options, see §②). Verify with `zoom` (RTL + the `•` bullet can look scrambled at small
   size but it saves correctly; watch for "Release notes provided for 1 language").
7. **Next** → **Preview and confirm**. The lone **Warning** — *"no deobfuscation file"* — is BENIGN
   (expected with `minifyEnabled false`; it appears on every release). Check device support is
   unchanged (no "Devices no longer supported").
8. **Save** → dialog **"Go to Publishing overview?"** → **Go to overview**. Save is **reversible** —
   it stages the change in Publishing overview; it does **not** publish.
9. **Publishing overview** (Managed publishing is OFF) → **Submit 1 change for review** → confirm
   **Send changes for review**. Status flips to **"Changes in review"** (a **Remove changes** button
   pulls it back until review starts). Quick checks run (≤14 min) → Google review → auto-publish to
   the testers; they auto-update within hours.

**Safety boundary:** step 8 **Save** is reversible; step 9 **Send changes for review** is the
outward-facing publish — do it only on the user's explicit go-ahead **for that release**. Note step 4
(uploading the AAB) already **burns the versionCode** even into a later-discarded draft, so only ever
deploy a FINAL build. If the change is **shared client code** (e.g. the masjid/GPS fix), a web
redeploy (`docs/DEPLOYMENT.md`) ships the same improvement to the live site — mention it, but it's a
separate, optional action from this Play deploy.

### ①c Open testing: the current deploy target (since v2.5.0, 2026-08-25)

Since **v2.5.0 / vc11** the deploy target moved to the **Open testing** track (the owner promoted it).
The closed **Alpha** track stays at vc10 and is **no longer the target**, so don't upload there
anymore. Track URL: `.../tracks/open-testing`. The click-path is identical to §①b, just under **Test
and release → Testing → Open testing** instead of Closed testing.

- **The track is pre-configured** (owner, one-time): countries **Iraq + United States** (**Jordan**
  added 2026-10-19 on the owner's request, sent for review as a standalone country change), plus
  **"unsync from production"** (the track manages its own countries instead of inheriting
  Production's). The first release, **`11 (2.5.0)`**, was sent for review **2026-08-25** as **four
  bundled changes**: the release rollout, the two country additions, the production-unsync, and the
  track resume (next bullet).
- ⚠ **A newly created open track starts PAUSED.** The banner reads *"Testers are not receiving this
  release"*, and it **stays paused even after the release's review clears**. **"Resume track"** is a
  **separate change** that must ALSO be submitted for review. Submitting a new change while a review
  is already in progress **restarts that review** (a dialog warns you); that is fine when the review
  is only minutes old but costly later, so **bundle the resume into the same submission** as the
  release.
- **What open testing means:** anyone can join, via the public opt-in page
  `https://play.google.com/apps/testing/com.altijwal.prayer` and straight from the Play listing in
  the selected countries. Tester feedback is **private** and does **not** affect the public rating.
  **Send the 12 closed-Alpha testers the open-test link** so they migrate; their old Alpha track no
  longer receives new builds.
- **Dashboard "Production: Inactive" is expected:** the app has never had a production release. It
  flips only when a release rolls out to the **Production** track, which is the next milestone after
  the open test.
- **Pre-launch report** still auto-runs on the open-track build, so check it after publishing (§④).

### ①d Production rollout checklist (the next milestone after the open soak)

The app has **never had a production release**, and Google offers **no staged-percentage rollout for a
first production release** (the percentage slider appears only from the *second* production release
onward). There is therefore no "1% then watch" safety valve, so promote to Production only after an
**open-testing soak** that clears defined thresholds:

- **Crash-free rate** healthy on **Play Vitals** (the open track feeds it; check once testers have
  used the build for a real stretch).
- **No alarm-reliability regressions** reported by testers (the offline ring is the core feature;
  see `NATIVE_ALARM_RELIABILITY_SPEC.md`).
- **Data Safety re-verified against the vc12 build.**

Then **re-walk the Data Safety form against the current manifest**, including the new
**`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`** permission, before submitting for production.

### ② Release notes «ما الجديد» — AR (v2.2.0, **user-approved 2026-07-25**)

```
• أقرب المساجد: أسرع، وتعمل بدون إنترنت، مع إمكانية إضافة مسجد غير موجود.
• تحسينات في الأداء واستهلاك البيانات.
```

<details><summary>v2.1.2 (vc7) notes — shipped 2026-07-24</summary>

```
• إصلاح «أقرب المساجد»: تظهر القائمة الآن بشكل أسرع وأكثر موثوقية دون رسالة خطأ.
```
</details>

<details><summary>v2.1.1 (vc6) notes — shipped 2026-07-23</summary>

```
• إصلاح: شاشة المنبّه لم تعد تختفي عند فتح قفل الهاتف، وتبقى ظاهرة حتى توقفها بنفسك.
• تحسينات في الأداء وسرعة التطبيق.
```
</details>

<details><summary>v2.1.0 (vc3/vc4) notes — shipped 2026-07-22</summary>

```
• تصفّح أسرع: مرّر بإصبعك للتنقل بين التبويبات.
• بوصلة القبلة أوضح، وتنبّهك الآن عند الحاجة إلى معايرة الهاتف.
• أقرب المساجد: إصلاح تحديد الموقع، مع عرض المساجد فقط.
• الجدول الشهري يفتح تلقائيًا في تبويب المواقيت.
• تحسينات في شريط التنقل السفلي، التصميم، والأداء.
```
</details>

### ③ Keeping the 12 testers rolling (your actual question)

- **Uploading a new build does NOT reset the 14-day clock.** The requirement is *12+ testers opted
  in continuously for 14 days*; it tracks tester opt-in, not builds. A new release on the **same**
  track just updates the app for the people already on it. (If the 14 days already elapsed, you stay
  eligible — don't drop below 12 opted-in testers.)
- **Testers need to do nothing** — Play auto-updates the app on their devices within a few hours
  (faster if they open the Play Store listing via the same opt-in link, or have auto-update on).
- The **opt-in link and tester list are unchanged** (Console → Closed testing → **Testers** tab).
  Only add/replace people here if someone dropped out and you're below 12.
- Nudge them (optional): "تحديث جديد وصل للتطبيق، افتحوه وجرّبوه" — genuine opens/feedback help when
  you later apply for production.
- Check progress: Console → Dashboard shows the **closed-testing eligibility** status (X/12 testers,
  days remaining). When it's satisfied, the **"Apply for production"** action appears (Phase 5.3).

### ④ After rollout

1. Copy the shipped AAB into the release history table below (already done through vc5).
2. Watch the **Pre-launch report** (Console → Test and release → Pre-launch report) — auto-runs the
   build on real Google devices; fix anything it flags before/for the next bump.
3. Sideload note: the Play copy is app-key-signed, so a locally-signed `*-release.apk` won't install
   over it (signature mismatch) — uninstall the Play build first if you test both.

### ⑤ Rebuild the AAB from scratch (only if you change code and bump the version)

```powershell
# bump client/package.json version + mirror versionName & versionCode(+1) in app/build.gradle,
# add a CHANGELOG entry, then:
cd D:\dev\prayer\client; npm run build; npx cap sync android
cd android; .\gradlew.bat bundleRelease      # → app\build\outputs\bundle\release\app-release.aab
# copy to D:\keys\releases\prayer-vX.Y.Z-vcN.aab  (canonical archive; gradle output is overwritten)
```

Sanity before uploading: `npm test` green · `findstr /m astronomy client\dist\assets\*.js` → only
the `api-*.js` chunk · confirm `META-INF/UPLOAD.RSA` exists in the AAB (`unzip -l …`).

---

## Phase 0 — Developer account (once)

1. Go to https://play.google.com/console/signup → **Personal** account → pay the **one-time $25**.
2. Verification (blocks publishing until done): create/link a **Google Payments profile** (your legal
   name/address come from it), verify the **developer email** + **phone** (OTP), and upload a
   **government ID** if asked. D-U-N-S is for organizations only — not needed. Takes hours→days.
3. Personal accounts created now fall under the **closed-testing requirement** (Phase 5): **12
   testers opted in continuously for 14 days** before you can apply for production.
   [Requirements](https://support.google.com/googleplay/android-developer/answer/14151465) ·
   [12-tester guide](https://support.google.com/googleplay/android-developer/community-guide/255621488)
4. Note: your **name + email are shown publicly** on the listing (free apps: no public address needed).

## Phase 1 — Signing + the release bundle (local, once)

Play requires an **AAB** (not APK) and **Play App Signing** (Google holds the app key; you sign
uploads with your own *upload key*). [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)

1. **Generate the upload keystore** (OUTSIDE the repo, e.g. `D:\keys\`):
   ```powershell
   mkdir D:\keys -Force
   keytool -genkeypair -v -keystore D:\keys\prayer-upload.jks -alias upload `
     -keyalg RSA -keysize 2048 -validity 10000
   # CN=Abdu, OU/O optional, C=IQ — pick strong store+key passwords
   ```
   Record path + both passwords in `docs/OPERATIONS.md`. Losing it is recoverable via Play support
   (upload-key reset), but treat it as precious anyway. `*.jks` + `key.properties` are gitignored.
2. **Create `client/android/key.properties`** (gitignored):
   ```properties
   storeFile=D:/keys/prayer-upload.jks
   storePassword=<store password>
   keyAlias=upload
   keyPassword=<key password>
   ```
3. **Wire signing into `client/android/app/build.gradle`** — add ABOVE the `android {` block:
   ```gradle
   def keystoreProperties = new Properties()
   def keystorePropertiesFile = rootProject.file('key.properties')
   if (keystorePropertiesFile.exists()) {
       keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
   }
   ```
   and INSIDE `android { ... }`:
   ```gradle
   signingConfigs {
       release {
           if (keystorePropertiesFile.exists()) {
               storeFile file(keystoreProperties['storeFile'])
               storePassword keystoreProperties['storePassword']
               keyAlias keystoreProperties['keyAlias']
               keyPassword keystoreProperties['keyPassword']
           }
       }
   }
   ```
   then in the existing `buildTypes { release { ... } }` add: `signingConfig signingConfigs.release`.
4. **Build the bundle:**
   ```powershell
   cd D:\dev\prayer\client; npm run build; npx cap sync android
   cd android; .\gradlew.bat bundleRelease
   # → app\build\outputs\bundle\release\app-release.aab
   ```
5. Sanity: `npm test` green; `findstr /m astronomy ..\dist\assets\*.js` → only the `api-*.js` chunk.

**Every later update (semver from 2.0.0 — ADR-008, `docs/V2_REDESIGN_SPEC.md`):** bump
`client/package.json` `version` (increment level matches the change: MAJOR = UX overhaul/breaking,
MINOR = new feature, PATCH = fix), mirror it into `versionName` and bump `versionCode` (+1) in
`app/build.gradle`, add a `CHANGELOG.md` entry, rebuild, upload the new AAB.

## Phase 2 — Privacy policy (BLOCKER — must be a live URL before review)

Requirements: public URL, not a PDF, not geofenced, titled "Privacy Policy", names the app/developer,
discloses location collection + retention + contact. [Policy](https://support.google.com/googleplay/android-developer/answer/10144311)

**Do:** drop the draft below into `client/public/privacy.html`, deploy the web app
(`docs/DEPLOYMENT.md`), then use **`https://prayer.altijwal.com/privacy.html`** in the Console.

⚠ **Before publishing it, verify the server doesn't retain raw coordinates in logs** (pino request
logs on `/api/prayer-times` + `/api/geo/*`). If logs keep lat/lon beyond normal rotation, either
redact them or change the wording "لا نحتفظ بها" accordingly. The Data-safety "ephemeral" answer
(Phase 4) must match this.

> **2026-07-26 — re-checked and now enforced by code, not by inspection.** There is still no
> request-logging middleware, so query strings are never logged. Two gaps were closed: the masjid
> contribution handler used to log the submitted lat/lon to stdout (removed), and the admin log
> ring buffer redacts `lat`/`lon` (plus DSN passwords and every configured secret) before storing
> a line — `server/src/log-buffer.ts`, covered by `log-buffer.test.ts`.
>
> **The privacy policy in this section is OUT OF DATE.** The live text was rewritten on 2026-07-26
> for the anonymous audience ping and to correct the reminders claim; the source of truth is
> `client/public/privacy.html`, not the draft below.

⚠ **User-visible text — review/edit before hosting** (standing rule):

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>سياسة الخصوصية — مواقيت الصلاة | Privacy Policy</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem;
           background: #04181a; color: #eafaf6; line-height: 1.8; }
    h1, h2 { color: #f5c451; } a { color: #2dd4bf; } hr { border-color: #234; margin: 2rem 0; }
    .en { direction: ltr; text-align: left; }
  </style>
</head>
<body>
  <h1>سياسة الخصوصية — تطبيق «مواقيت الصلاة»</h1>
  <p>آخر تحديث: 2026-07-11</p>
  <p>تطبيق «مواقيت الصلاة» (com.altijwal.prayer) وموقع prayer.altijwal.com خدمة مجانية لعرض
     مواقيت الصلاة. خصوصيتك أولوية: لا حسابات، لا إعلانات، لا أدوات تتبّع أو تحليلات، ولا نبيع أو
     نشارك أي بيانات مع أي طرف ثالث.</p>
  <h2>البيانات التي نعالجها</h2>
  <ul>
    <li><b>الموقع الجغرافي (اختياري):</b> يعمل التطبيق افتراضيًا على مدينة بغداد دون أي إذن.
        إذا اخترت «استخدام موقعي» أو بحثت عن مدينة، تُرسل الإحداثيات عبر اتصال مشفّر (HTTPS)
        إلى خادمنا لغرض وحيد: حساب مواقيت الصلاة وتحديد المدينة والمنطقة الزمنية. تُعالَج
        الإحداثيات لحظيًا للإجابة على الطلب ولا نحتفظ بها ولا نربطها بهويتك.</li>
    <li><b>بيانات محلية على جهازك فقط:</b> إعدادات التنبيهات، المدينة المختارة، وسجل العبادات
        (إن فعّلته) تُخزَّن في ذاكرة التطبيق على جهازك ولا تغادر الجهاز. حذف التطبيق يمحوها نهائيًا.</li>
  </ul>
  <h2>الأذونات</h2>
  <p>يستخدم التطبيق أذونات التنبيهات والمنبّهات الدقيقة وملء الشاشة حصريًا لإطلاق منبّه الصلاة في
     وقته حتى والتطبيق مغلق. لا تُستخدم لأي غرض آخر.</p>
  <h2>حذف البيانات</h2>
  <p>لا نخزّن بيانات عنك على خوادمنا، فلا يوجد ما يُطلب حذفه. حذف التطبيق يزيل كل البيانات المحلية.</p>
  <h2>التواصل</h2>
  <p>لأي استفسار: <a href="mailto:contact@al-tijwal.com">contact@al-tijwal.com</a></p>
  <hr />
  <div class="en">
    <h1>Privacy Policy — “Prayer Times” (مواقيت الصلاة)</h1>
    <p>Last updated: 2026-07-11. The app (com.altijwal.prayer) and prayer.altijwal.com are a free
       prayer-times service. No accounts, no ads, no analytics or tracking SDKs; we never sell or
       share data with third parties.</p>
    <p><b>Location (optional):</b> the app defaults to Baghdad with no permission. If you opt in to
       GPS or search for a city, coordinates are sent over HTTPS to our own server for one purpose:
       computing prayer times and resolving the city/timezone. They are processed transiently to
       answer the request, are not retained, and are never linked to your identity.</p>
    <p><b>On-device data:</b> reminder rules, chosen city, and the optional worship log are stored
       only in the app's local storage; uninstalling deletes them. Notification/exact-alarm/
       full-screen permissions are used solely to ring prayer alarms on time while the app is
       closed.</p>
    <p><b>Deletion:</b> we store nothing about you server-side; uninstalling removes all local data.
       Contact: contact@al-tijwal.com</p>
  </div>
</body>
</html>
```

## Phase 3 — Store assets

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 **32-bit PNG with alpha**, ≤1 MB | ✅ `client/public/icons/icon-512.png` |
| Feature graphic | 1024×500 JPG/**24-bit PNG no alpha** | Generate ↓ |
| Phone screenshots | **min 2** (do 4+), JPG/24-bit PNG, each side 320–3840 px, **16:9 or 9:16**; ≥1080 px short side for featuring | Capture ↓ |
| Tablet 7"/10" | optional — skip for v1 | — |
| Video | optional YouTube — skip | — |

[Asset specs](https://support.google.com/googleplay/android-developer/answer/9866151)

**Feature graphic** (run from `client/` — flatten alpha, brand night, centered logo):
```powershell
node -e "const s=require('sharp'); s({create:{width:1024,height:500,channels:3,background:'#04181a'}}).composite([{input:'assets/icon-only.png',top:50,left:312,},]).png().toFile('play-feature.png')" 
# then resize the logo layer if needed: use assets/icon-foreground.png resized to 400x400 first:
node -e "const s=require('sharp'); (async()=>{const logo=await s('assets/icon-only.png').resize(400,400).toBuffer(); await s({create:{width:1024,height:500,channels:3,background:'#04181a'}}).composite([{input:logo,top:50,left:312}]).png().toFile('play-feature.png')})()"
```

**Screenshots** — the emulator is 1080×2400 (9:20); Play wants 9:16 → crop to 1080×1920:
```powershell
# capture (emulator prayer36 running, app on the screen you want):
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" exec-out screencap -p > shot1.png
# crop top-anchored to 9:16:
node -e "require('sharp')('shot1.png').extract({left:0,top:240,width:1080,height:1920}).png().toFile('play-shot1.png')"
```
Suggested set (≥4): main clock screen · Settings → تذكيرات الصلاة with a rule open · the ring screen
(fire via the root-broadcast smoke test in `docs/NATIVE_ALARM_FIXES_SPEC.md` §4.3) · hero with
worship features on. Screenshots must show the REAL app (no mockup frames with device bezels needed).

## Phase 4 — Play Console: create app + every form answer

**Create app:** name `مواقيت الصلاة` · default language **العربية — ar** · App · Free · accept both
declarations.

**Main store listing** (the text APPLIED to the Console + submitted for review 2026-08-25):
- Short description (≤80 chars):
  > مواقيت الصلاة والأذان بدقة، ومنبّه يرنّ في وقت الصلاة حتى دون إنترنت
- Full description (≤4000):
  > يعرض التطبيق أوقات الصلاة بدقة لموقعك، مع عدّاد تنازلي حيّ للأذان القادم.
  >
  > ★ دقة عالية في العراق: مواقيت معايَرة لكل محافظة على حدة.
  > ★ منبّه حقيقي بملء الشاشة: يرنّ بالنغمة التي تختارها في وقت الصلاة تماماً، حتى والتطبيق مغلق والهاتف دون إنترنت.
  > ★ يعمل دون اتصال: بعد اختيار موقعك أول مرة، تُحسب المواقيت على جهازك مباشرة.
  > ★ تذكيرات مرنة لكل صلاة: قبل الأذان أو بعده بالدقائق التي تريدها، كإشعار هادئ أو منبّه كامل.
  > ★ اتجاه القبلة ببوصلة دقيقة، وأقرب المساجد مع الاتجاهات وزمن الوصول مشياً أو بالسيارة.
  > ★ التقويم الهجري والمناسبات الإسلامية القادمة.
  > ★ مزايا اختيارية تفعّلها متى شئت: الضحى وقيام الليل، السنن الرواتب، أذكار الصباح والمساء مع عدّاد باللمس، وسجلّ نقاط وتقارير لمواظبتك على الصلاة.
  > ★ أربعة أنماط بصرية أنيقة تختار منها ما يناسبك.
  > ★ بدون إعلانات، بدون حسابات، مجاني بالكامل.
  >
  > يدعم جميع مدن العالم مع اختيار طريقة الحساب المناسبة تلقائياً لكل بلد.
- Graphics: icon 512 + feature graphic + screenshots (Phase 3).

**Store settings:** Category **Lifestyle** · tags (e.g. "Religion & spirituality") · contact email
`contact@al-tijwal.com` · website `https://prayer.altijwal.com`.

**App content (Policy → App content) — exact answers:**

| Form | Answer |
|---|---|
| Privacy policy | `https://prayer.altijwal.com/privacy.html` |
| App access | **All functionality available without special access.** Reviewer note (EN): "No login. Location optional — the app defaults to Baghdad. To test the alarm: Settings (top-left icon) → تذكيرات الصلاة → add a reminder, choose منبّه kind; it rings full-screen at the prayer time, fully offline." |
| Ads | **No** (no ad SDKs) |
| Content rating (IARC) | Email → category **Utility/Productivity/Other** → all content questions **No** → interactive elements: users interact **No**, shares location with other users **No**, purchases **No** → results ~Everyone/PEGI 3 |
| Target audience | **13+ only** (never tick under-13 → avoids Families policy) · appeals to children: **No** |
| News app | No |
| COVID-19 tracing/status | No (form still exists — answer No) |
| Data safety | see below |
| Advertising ID | **No** — verified: the merged manifest contains no `AD_ID` permission (checked 2026-07-11; re-check after adding any dependency: `grep AD_ID app/build/intermediates/merged_manifests/...`) |
| Government app | No |
| Financial features | **My app doesn't provide any financial features** |
| Health | **My app does not have any health features** |
| Account deletion | No accounts created → confirm |

> ✅ **DONE AND PUBLISHED (2026-07-26).** The form below was fully entered, saved, and sent for
> review **together with release `9 (2.3.0)`** (`Closed testing – Alpha → Start full rollout` +
> `App content → Data safety`). Ordering was deliberate: the questionnaire was completed *first* so
> the release never went out behind a declaration that denied its own collection.
>
> **Review cleared the same day.** Publishing overview went from "Changes in review" to empty,
> "Last published" moved from 25 → **26 July 2026**, and the Console raised *"App update published.
> Users should see changes immediately."* (Those three signals are the evidence; the per-track
> version number could not be read back because the Console was throwing `71556E12` /
> `56B6DD63` on the track pages at the time. Confirm on the track when it is healthy.)
>
> What was entered in **step 4 "Data usage and handling"**
> (`.../app-content/data-privacy-security`, then Next ×3 — the stepper circles are not clickable):
>
> | Row | Answered |
> |---|---|
> | **Approximate location** (was "Completed" — EDITED) | processed ephemerally Yes → **No**; purposes **App functionality + Analytics**; left **optional** |
> | **App activity → App interactions** (new) | Collected · shared No · ephemeral No · purpose **Analytics** · **required** |
> | **Device or other IDs** (new) | Collected · shared No · ephemeral No · purposes **App functionality + Fraud prevention, security and compliance** · **required** |
>
> **Precise location was left untouched** (collected, ephemeral Yes, App functionality).
>
> Step-5 preview verified before saving: "No data shared with third parties" · Approximate location
> *Optional* → App functionality, Analytics · App interactions → Analytics · Device or other IDs →
> App functionality, Fraud prevention, security and compliance · encrypted in transit · no
> data-deletion route · policy URL. **Precise location does not appear in the Store-listing preview
> at all** — Play omits ephemeral-only data types from the public listing, so its absence there is
> expected and is *not* a sign the answer was lost.
>
> Console quirks worth knowing next time: the sub-form **Save** button sits in the page footer and
> the browser window can resize mid-flow (a click at the old coordinates silently misses — re-shoot
> before clicking); each sub-form Save shows a "<type> saved" toast; the step-5 Save then offers
> "Go to Publishing overview". Review runs after a "quick checks for commonly found issues" pass
> (~14 min) — changes are forwarded automatically once it succeeds. Review itself ≤7 days.

**Data safety form** (rewritten 2026-07-26 for v2.3.0/vc9 — the admin dashboard added an
anonymous audience ping AND surfaced two pre-existing declarations that were wrong):

- Does your app collect or share user data? **Yes.**
- **Location → Precise location: Collected.** Shared? No · processed **ephemerally**: **Yes** ·
  required? No (optional) · purpose: **App functionality**. (Sent to compute prayer times when the
  user taps «استخدام موقعي» or searches a city; not retained for that purpose.)
- **Location → Approximate location: Collected.** Shared? No · processed ephemerally: **NO — it is
  retained** · required? No (optional) · purposes: **App functionality + Analytics**.
  ⚠ CHANGED: the daily ping stores an area rounded to ~1 km for up to 180 days, so the previous
  "ephemeral" answer for approximate location is no longer true.
- **App activity → App interactions: Collected.** Shared? No · ephemeral: No · required? Yes ·
  purpose: **Analytics**. ⚠ NEW: the once-a-day ping (app version, platform, features enabled,
  theme). Declared "required" because there is no in-app opt-out — see the note below.
- **Device or other IDs: Collected.** Shared? No · ephemeral: No · required? Yes · purposes:
  **App functionality + Fraud prevention/security**.
  ⚠ CORRECTION, not a new behaviour: the app has sent a persistent per-install `X-Client-Id` with
  every masjid lookup since ADR-014, and `places_usage` stores it for 90 days to enforce the spend
  caps. The old form said no identifiers were collected, which was wrong. (The telemetry ping does
  NOT store it — it stores a key that rotates daily.)
- Everything else (personal info, files, messages, contacts, financial…): **Not collected.**
  Reminder rules, worship log and settings never leave the device — that is not "collection".
- Security: encrypted in transit? **Yes.**
- Data deletion: **no accounts.** Turning reminders off deletes the stored subscription; usage
  statistics are anonymous, cannot be linked to a person, and expire within 180 days.
  [Data safety help](https://support.google.com/googleplay/android-developer/answer/10787469)

**Why "required" for the analytics items:** the owner chose privacy-policy-only notice with no
in-app opt-out switch (2026-07-26). That is a defensible position for a non-identifying aggregate
count, but it means the form cannot claim the collection is optional, and there is no mechanism to
honour an individual opt-out request. Adding a Settings toggle later is ~20 lines plus one Arabic
string; if it is added, flip these two to "optional".

**What backs these answers** (so a future re-review does not have to re-derive them):
- what is sent: `client/src/lib/telemetry.ts` (`buildPingBody`, `TELEMETRY_PRECISION_DEG = 0.01`);
- what is stored: `server/src/telemetry/routes.ts` + the `usage_ping` DDL in `server/src/db/schema.ts`;
- why cross-day linkage is impossible: `server/src/telemetry/hash.ts` (the day is inside the HMAC);
- retention actually runs: `server/src/db/retention.ts`;
- coordinates are no longer written to logs: `server/src/log-buffer.ts` redaction +
  `masjid-contributions.ts` (the lat/lon log line was removed 2026-07-26).

**Sensitive-permission declarations** (appear after the first AAB upload):
- **Exact alarms (`USE_EXACT_ALARM`)** — use case: **alarm functionality is a core feature**.
  Wording: "The app's core function is user-configured prayer alarms that must ring full-screen at
  the exact prayer minute, including offline and after reboot, like a clock app." ⚠ Policy text says
  "alarm or timer app"; prayer-alarm apps normally pass, but if rejected: remove `USE_EXACT_ALARM`
  from the manifest and rely on `SCHEDULE_EXACT_ALARM` (no declaration needed; the in-app permission
  row already routes users to grant it) — the code already falls back gracefully.
- **Full-screen intent (`USE_FULL_SCREEN_INTENT`)** — declare **alarm** core functionality (keeps the
  Android 14+ automatic grant). The app already degrades to heads-up + tone if FSI is revoked.
- **Battery-optimization exemption (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`)** (use case: **core alarm
  reliability**). The app requests the exemption **in onboarding** (a user-initiated permission row in
  `NativeReminders`, never silent) so offline prayer alarms survive **Doze** and OEM battery
  management. Declare it as core alarm functionality alongside the two above.
- **Foreground service** — ✅ **no declaration needed**: the alarm service is `shortService`
  (declaration + demo video are only demanded for other FGS types). `RECEIVE_BOOT_COMPLETED` needs no
  declaration either.
  [FGS/FSI requirements](https://support.google.com/googleplay/android-developer/answer/13392821)

## Phase 5 — Testing tracks → production (the long pole)

1. **Internal testing** (instant): create an email list with your own device's account → upload the
   AAB → install via the opt-in link → sanity-pass on real hardware. Watch the **pre-launch report**
   (auto-runs on real devices; fix any crash it finds — it also flags edge-to-edge issues, which are
   already handled).
2. **Closed testing — the 12×14 requirement:** create a Closed track → upload the same AAB → add an
   email list with **12+ real people** (family/friends; Gmail addresses) → send them the opt-in link.
   Rules: they must stay **opted-in 14 consecutive days** (dropping below 12 can reset the clock) and
   should genuinely open the app — the production application asks about tester engagement.
3. **Apply for production** (Dashboard button appears when eligible): answer honestly about the test
   (who your testers are, what feedback you got, why it's ready). Review ≤7 days.
4. **Production:** create the release, same AAB (or a bumped one), roll out 100% (staged rollout is
   overkill for v1). First-app review: typically 1–7 days (declaration-heavy apps trend longer).
5. **Wrapper-app defense** (policy 4.3 "minimum functionality") — if a reviewer questions the WebView:
   the app bundles all assets locally (no remote URL), computes prayer times **on-device offline**,
   and ships native exact alarms + full-screen ring + boot rescheduling. State this in the review
   notes proactively.

## Release history / archived artifacts

Gradle output at `app/build/outputs/**` is overwrite-prone — copy each shipped build to
`D:\keys\releases\` and treat that as canonical:

| Version | versionCode | Artifacts (`D:\keys\releases\`) | Notes |
|---|---|---|---|
| 1.0 | 1 | `prayer-v1.0-vc1.aab` | first closed-track release |
| 2.0.0 | 2 | `prayer-v2.0.0-vc2.aab` · `prayer-v2.0.0-vc2-release.apk` · `prayer-v2.0.0-vc2-debug.apk` | built + signed 2026-07-14; web half deployed to prod. Release APK for device testing; debug APK for `chrome://inspect`. |
| 2.1.0 | 3 | `prayer-v2.1.0-vc3.aab` · `prayer-v2.1.0-vc3-debug.apk` | built + signed 2026-07-19; superseded by vc4 before upload. Full v2.1 client also deployed to the prod web this day. Debug APK real-device-verified on a Pixel 7 Pro (swipe, tab bar, compass). |
| 2.1.0 | 4 | `prayer-v2.1.0-vc4.aab` | **uploaded 2026-07-22** to Closed testing – Alpha as release `4 (2.1.0)`, AR notes attached, sent for review (177 countries). |
| 2.1.1 | 5 | `prayer-v2.1.1-vc5.aab` | **STALE — do not ship.** Alarm fix only; uploaded to the bundle library 2026-07-23 before the month-table removal landed, which burned the version code. |
| 2.1.1 | 6 | `prayer-v2.1.1-vc6.aab` | built + signed 2026-07-23 — alarm-screen unlock fix (`NATIVE_ALARM_FIXES_SPEC.md` §2h, verified on the emulator **and** on the user's Pixel 7 Pro with a real armed rule) + monthly table removed / tab renamed «الاتجاهات» (`FRONTEND.md` §11). |
| 2.1.2 | 7 | `prayer-v2.1.2-vc7.aab` | built + signed 2026-07-24 — nearest-masjid cold-GPS resilience fix: last-known-first + patient coarse fallback + silent refine + fetch retry (`QIBLA_MASJID_SPEC.md` Session 7). Samsung Auto Blocker investigated + ruled out. Gates green (build · 148 client · 175 server · engine gate · code-review HIGH resolved). ⚠ NOT yet field-verified on the actual cold-GPS case. |
| 2.2.0 | 8 | `prayer-v2.2.0-vc8.aab` | **uploaded + sent for review 2026-07-25** as release `8 (2.2.0)`. Places quota work (ADR-014): resident OSM masjid dataset (9,835 rows) + user contributions + estimated travel times with a real lookup on expand + fetch discipline + offline list. Server half deployed to prod the same day. Gates green (build · 157 client · 286 server · engine gate) and **device-verified on the user's Pixel 7 Pro** before upload. Console checks: 0 devices lost, +2.51 KB, only the benign no-deobfuscation warning. |
| 2.3.0 | 9 | `prayer-v2.3.0-vc9.aab` | **uploaded, sent for review AND published 2026-07-26** (review cleared same day) as release `9 (2.3.0)`, Closed testing – Alpha, full rollout. Admin dashboard at `/admin` + anonymous audience ping (`ADMIN_DASHBOARD.md`, ADR-015/016). Sent **together with the rewritten Data safety questionnaire** — that ordering is the point: the ping collects data the old declaration denied. |
| 2.4.0 | 10 | `prayer-v2.4.0-vc10.aab` | **uploaded + sent for review 2026-08-12**, Closed testing – Alpha. Year-round exact Waqf times (adjudicated full-year archive + same-date recycle, ADR-017) + masjid directions embed fix. Web half deployed to prod the same day. |
| 2.6.0 | 12 | `prayer-v2.6.0-vc12.aab` | **uploaded + sent for review 2026-08-26 on Open testing** (`12 (2.6.0)`, full rollout). Production-hardening round: push endpoint allowlist + write rate limits, public-endpoint limits + success-only edge caching + compression, contribution caps + silent venue filter at read-back, scheduler single-flight, retention (orphan subs 45d, cell demand 400d), DB-startup retry + governor fail-closed, local error ring buffer + native crash logger, alarm-cap observability, `allowBackup=false`, **nearest-masjids Iraq-only (server geofence + client gating)**. Gates green (build · 196 client · 475 server · engine gate); 2 Codex review rounds + 2 scoped verifies to SHIP. Only the benign no-deobfuscation warning. |
| 2.5.0 | 11 | `prayer-v2.5.0-vc11.aab` | **uploaded + sent for review 2026-08-25 as the FIRST OPEN-TESTING release; cleared review + LIVE 25 Aug** (`11 (2.5.0)`, full rollout; track pre-configured by the owner: countries Iraq + United States, unsynced from production). Alarm reliability round (`NATIVE_ALARM_RELIABILITY_SPEC.md`): missed-alarm + pre-alarm-dismiss notifications, direct-boot chain + DE storage, exact-alarm fallback fix, resync canary + horizon nag, JS hardening. Gates green (build · 182 client · 414 server · engine gate); features + fixes emulator-verified, incl. ringing before first unlock; 4 Codex review rounds + a delta pass to SHIP. Only the benign no-deobfuscation warning. |

**Sideload testing gotcha:** a locally-signed APK (`*-release.apk`, signed with the upload key)
will NOT install over a copy the phone got from Play (Google re-signs with the app-signing key —
signature mismatch). Uninstall the Play build first (wipes on-device app data: worship log,
settings — all local); reinstall from Play once the track updates.

## Post-launch updates

```powershell
# 1. bump client/package.json version (semver — MAJOR/MINOR/PATCH by change size)
# 2. mirror into versionName + bump versionCode (+1 → next is 12) in client/android/app/build.gradle
# 3. add the CHANGELOG.md entry, then:
cd D:\dev\prayer\client; npm run build; npx cap sync android
cd android; .\gradlew.bat bundleRelease         # AAB for Play
# (optional) .\gradlew.bat assembleRelease       # signed APK for device testing
# copy outputs to D:\keys\releases\, then upload the AAB to the target track → roll out
```

## 2025/2026 changes already handled / not applicable

- **Target API:** requirement is 35+ now, 36 by Aug 31 2026 — we target **36** ✅.
- **Edge-to-edge (mandatory at target 36):** insets consumed in CSS + night system bars ✅
  (`docs/NATIVE_ALARM_FIXES_SPEC.md` §2f).
- **16 KB page size:** affects NDK apps only — no native libs here ✅.
- **FGS-from-boot ban (Android 15+):** BootReceiver only re-arms AlarmManager, never starts the
  service ✅; service is `shortService` anyway.
- **Android Developer Verification (sideloading, Sep 2026+):** your Play verification covers it.
- Before submitting, skim the latest policy announcements:
  https://support.google.com/googleplay/android-developer/answer/16926792

## Open items on you

**v2.5.0 / vc11 is LIVE on Open testing (published 25 Aug); v2.6.0 / vc12 is IN REVIEW (sent
2026-08-26, full rollout, with the updated store-listing descriptions also in review).** Nothing is
owed on them beyond keeping ≥12 testers opted in and sending the closed-Alpha testers the open-test
opt-in link (§①c). Once Google's review clears, Play auto-updates the testers within hours. For the
*next* update (**versionCode 13**), follow the **Update runbook** at the top: (1) get the AR release
notes OK'd in §②, (2) build + archive the AAB, (3) upload it to the **Open testing** track.

**One-time setup (done — kept for reference):**
1. ~~Pay the $25 + finish identity verification.~~ ✅
2. Approve/edit the **Arabic store texts** + **privacy policy**; deploy `privacy.html`. ✅
3. Confirm the server-log/coordinates check (Phase 2 ⚠) before the Data-safety "ephemeral" answer. ✅
4. Generate the keystore (Phase 1) and record it in `docs/OPERATIONS.md`. ✅ (`prayer-upload.jks`)
5. Recruit **12 testers** and keep them opted in for 14 days. — ongoing (keep them on the track).
