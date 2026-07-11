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
| Contact email | `abdu.bns@gmail.com` (verified + shown publicly) |
| First release | `versionCode 1`, `versionName "1.0"` (`client/android/app/build.gradle`) |

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

**Every later update:** bump `versionCode` (+1) and `versionName` in `app/build.gradle`, rebuild,
upload the new AAB.

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
  <p>لأي استفسار: <a href="mailto:abdu.bns@gmail.com">abdu.bns@gmail.com</a></p>
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
       Contact: abdu.bns@gmail.com</p>
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
`abdu.bns@gmail.com` · website `https://prayer.altijwal.com`.

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

## Post-launch updates

```powershell
# bump versionCode (+1) + versionName in client/android/app/build.gradle, then:
cd D:\dev\prayer\client; npm run build; npx cap sync android
cd android; .\gradlew.bat bundleRelease
# upload app-release.aab to Production → roll out
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

## Open items on you (nothing else blocks)

1. Pay the $25 + finish identity verification.
2. Approve/edit the **Arabic store texts** + **privacy policy** above; deploy `privacy.html`.
3. Confirm the server-log/coordinates check (Phase 2 ⚠) before the Data-safety "ephemeral" answer.
4. Generate the keystore (Phase 1) and record it in `docs/OPERATIONS.md`.
5. Recruit **12 testers** and keep them opted in for 14 days.
