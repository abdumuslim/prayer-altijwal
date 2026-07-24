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

## Update runbook — ship a new version to the EXISTING closed track (repeatable)

> **This is the common path now.** Phases 0–4 below (account, signing, store listing, privacy,
> data-safety, permission declarations) are **one-time and already done** — you only revisit them if
> something structural changes. To push an update you do just this section. Everything the Console
> asks that isn't covered here keeps its Phase-4 answer.

### ⓪ What's ready for THIS release (v2.1.2)

- **Signed bundle:** `D:\keys\releases\prayer-v2.1.2-vc7.aab` — versionName **2.1.2**, versionCode
  **7**, signed with the upload key (`prayer-upload.jks`). Built + verified 2026-07-24
  (`META-INF/UPLOAD.RSA` present in the AAB); upload this file as-is.
- **What changed:** the **«أقرب المساجد» section no longer errors on the first visit.** It waits for a
  real GPS fix, and on a cold device (no recent fix, GNSS cold/indoors) both staged location attempts
  could time out before one landed → a location error instead of the mosques, self-healing once any
  fix arrived. Now it paints from the **last known position first**, falls back to a **patient coarse
  attempt** on a cold device, and **refines silently** in the background; the mosque fetch **retries
  once** on a transient hiccup. Diagnosed live on a tester's Samsung — **Samsung Auto Blocker was
  investigated and ruled out** (the feature works with it ON; it only blocks wireless adb). Full
  detail: `CHANGELOG.md` §2.1.2, `docs/QIBLA_MASJID_SPEC.md` Session 7. ⚠ **Shared client code**
  (`lib/gps-staging.ts`, `useLocation.ts`, `NearestMasjids.tsx`) — a web redeploy (`docs/DEPLOYMENT.md`)
  would ship the same reliability to the live site's masjid section, but it's **optional**; this Play
  update is what fixes it for the app testers.
- versionCode 7 > every previously uploaded code (1–6) → Play accepts it.
- Gate before upload (all green 2026-07-24): `npm run build` · **148** client tests · **175** server
  tests · code-review HIGH resolved + regression-tested ·
  `findstr /m astronomy client\dist\assets\*.js` → only `api-*.js` · `META-INF/UPLOAD.RSA` in the AAB.

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

### ② Release notes «ما الجديد» — AR (v2.1.2, **user-approved 2026-07-24**)

```
• إصلاح «أقرب المساجد»: تظهر القائمة الآن بشكل أسرع وأكثر موثوقية دون رسالة خطأ.
```

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

**Main store listing** (⚠ drafts — review/edit the Arabic before submitting):
- Short description (≤80 chars):
  > مواقيت الصلاة والأذان بدقة — منبّه يعمل دون إنترنت حتى والتطبيق مغلق
- Full description (≤4000 — draft):
  > تطبيق «مواقيت الصلاة» يعرض أوقات الصلاة بدقة لموقعك مع عدّاد تنازلي حيّ للأذان القادم.
  >
  > ★ دقة عالية في العراق: مواقيت مطابقة لجداول ديوان الوقف السني لكل محافظة.
  > ★ منبّه حقيقي: يرنّ بملء الشاشة بالنغمة التي تختارها في وقت الصلاة تمامًا — حتى والتطبيق
  >   مغلق والهاتف دون إنترنت.
  > ★ يعمل دون اتصال: بعد اختيار موقعك أول مرة، يحسب التطبيق المواقيت على جهازك مباشرة.
  > ★ تذكيرات مرنة: قبل الأذان أو بعده بالدقائق التي تريد، إشعار هادئ أو منبّه كامل.
  > ★ التقويم الهجري والمناسبات الإسلامية القادمة.
  > ★ اختياري: الضحى وقيام الليل، السنن الرواتب، أذكار الصباح والمساء مع عدّاد، وسجل نقاط
  >   لمواظبتك على الصلاة.
  > ★ بدون إعلانات، بدون حسابات، مجاني بالكامل.
  >
  > يدعم جميع مدن العالم مع تحديد الطريقة الحسابية المناسبة تلقائيًا لكل بلد.
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

**Data safety form:**
- Does your app collect or share user data? **Yes** (location is transmitted off-device).
- Data types: **Location → Approximate location: Collected** and **Precise location: Collected**
  (precise only if the user taps «استخدام موقعي»).
- For both: shared? **No** · processed **ephemerally**? **Yes — if the server-log check in Phase 2
  passed**, else No · required? **No (optional)** · purpose: **App functionality**.
- Everything else (personal info, files, activity, device IDs…): **Not collected**. (Reminder rules,
  worship log, settings never leave the device — that's not "collection".)
- Security: encrypted in transit? **Yes**. Deletion request mechanism: with ephemeral/no server
  storage the form allows declaring data isn't stored.
  [Data safety help](https://support.google.com/googleplay/android-developer/answer/10787469)

**Sensitive-permission declarations** (appear after the first AAB upload):
- **Exact alarms (`USE_EXACT_ALARM`)** — use case: **alarm functionality is a core feature**.
  Wording: "The app's core function is user-configured prayer alarms that must ring full-screen at
  the exact prayer minute, including offline and after reboot, like a clock app." ⚠ Policy text says
  "alarm or timer app"; prayer-alarm apps normally pass, but if rejected: remove `USE_EXACT_ALARM`
  from the manifest and rely on `SCHEDULE_EXACT_ALARM` (no declaration needed; the in-app permission
  row already routes users to grant it) — the code already falls back gracefully.
- **Full-screen intent (`USE_FULL_SCREEN_INTENT`)** — declare **alarm** core functionality (keeps the
  Android 14+ automatic grant). The app already degrades to heads-up + tone if FSI is revoked.
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

**Sideload testing gotcha:** a locally-signed APK (`*-release.apk`, signed with the upload key)
will NOT install over a copy the phone got from Play (Google re-signs with the app-signing key —
signature mismatch). Uninstall the Play build first (wipes on-device app data: worship log,
settings — all local); reinstall from Play once the track updates.

## Post-launch updates

```powershell
# 1. bump client/package.json version (semver — MAJOR/MINOR/PATCH by change size)
# 2. mirror into versionName + bump versionCode (+1 → next is 3) in client/android/app/build.gradle
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

**For the v2.1.2 update (now):** just the **Update runbook** at the top —
(1) OK the AR release notes in §②, (2) upload `prayer-v2.1.2-vc7.aab` to the closed track, (3) keep
≥12 testers opted in. Nothing else blocks; the one-time items below are already done.

**One-time setup (done — kept for reference):**
1. ~~Pay the $25 + finish identity verification.~~ ✅
2. Approve/edit the **Arabic store texts** + **privacy policy**; deploy `privacy.html`. ✅
3. Confirm the server-log/coordinates check (Phase 2 ⚠) before the Data-safety "ephemeral" answer. ✅
4. Generate the keystore (Phase 1) and record it in `docs/OPERATIONS.md`. ✅ (`prayer-upload.jks`)
5. Recruit **12 testers** and keep them opted in for 14 days. — ongoing (keep them on the track).
