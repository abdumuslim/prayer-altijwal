# Play Release Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all currently actionable Google Play setup for `com.altijwal.prayer`, produce verified store assets and a signed release bundle, and start the required testing track.

**Architecture:** Reuse the existing app artwork and real Android UI rather than creating mock screens. Produce deterministic Play assets under `client/play-store/`, verify the existing web/native/server builds, then use the signed-in Play Console for declarations, asset upload, bundle upload, and testing setup.

**Tech Stack:** Node.js 22, Sharp, Capacitor Android, Gradle, ADB/Android Emulator, Vitest, Google Play Console

## Global Constraints

- Preserve unrelated working-tree files.
- Never print, commit, or expose signing passwords or secret values.
- Use `com.altijwal.prayer`, versionCode `1`, versionName `1.0`, Arabic default language, and Lifestyle category.
- Use `contact@al-tijwal.com` and `https://prayer.altijwal.com` for public contact details.
- Use real app screenshots only; no mock UI or device frames.
- Do not submit a production rollout before the required closed test and production-access approval.

---

### Task 1: Generate and validate Play graphics

**Files:**
- Create: `client/play-store/feature-graphic.png`
- Create: `client/play-store/phone-main.png`
- Create: `client/play-store/phone-reminders.png`
- Create: `client/play-store/phone-alarm.png`
- Create: `client/play-store/phone-worship.png`
- Consume: `client/assets/icon-only.png`
- Consume: existing real screenshots or new emulator captures

**Interfaces:**
- Consumes: existing brand PNG artwork and ADB screenshots.
- Produces: one 1024×500 RGB PNG and four 1080×1920 RGB/RGBA PNG screenshots accepted by Play.

- [ ] **Step 1: Inspect candidate screenshots and select one per required view**

Run:

```powershell
Get-ChildItem D:\dev\prayer -Filter *.png | Select-Object Name,Length
```

Expected: candidates include main, settings/reminders, alarm, and worship screens.

- [ ] **Step 2: Check for the existing emulator before deciding whether replacement captures are needed**

Run:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
```

Expected: if an emulator is already available, `adb devices` reports one `emulator-*` device. Otherwise use the already verified real captures listed in Step 4.

- [ ] **Step 3: Generate the feature graphic from existing artwork**

Run from `client/`:

```powershell
New-Item -ItemType Directory -Force play-store
node -e "const s=require('sharp');(async()=>{const logo=await s('assets/icon-only.png').resize(400,400).toBuffer();await s({create:{width:1024,height:500,channels:3,background:'#04181a'}}).composite([{input:logo,top:50,left:312}]).png().toFile('play-store/feature-graphic.png')})()"
```

Expected: `feature-graphic.png` is exactly 1024×500 with three channels and no alpha.

- [ ] **Step 4: Crop four real screenshots**

Run these exact conversions from `D:\dev\prayer\client`:

```powershell
node -e "require('sharp')('../scratch_e2e_main.png').extract({left:0,top:240,width:1080,height:1920}).png().toFile('play-store/phone-main.png')"
node -e "require('sharp')('../scratch_tones_open.png').extract({left:0,top:240,width:1080,height:1920}).png().toFile('play-store/phone-reminders.png')"
node -e "require('sharp')('../scratch_ring_final2.png').extract({left:0,top:240,width:1080,height:1920}).png().toFile('play-store/phone-alarm.png')"
node -e "require('sharp')('../worship-hero-3on.png').resize(1080,2400,{fit:'fill'}).extract({left:0,top:240,width:1080,height:1920}).png().toFile('play-store/phone-worship.png')"
```

Expected targets: `phone-main.png`, `phone-reminders.png`, `phone-alarm.png`, and `phone-worship.png`.

- [ ] **Step 5: Validate dimensions and sizes**

Run from `client/`:

```powershell
node -e "const s=require('sharp');(async()=>{for(const f of ['play-store/feature-graphic.png','play-store/phone-main.png','play-store/phone-reminders.png','play-store/phone-alarm.png','play-store/phone-worship.png']) console.log(f,await s(f).metadata())})()"
```

Expected: feature is 1024×500; every phone image is 1080×1920; all files are below Play size limits.

- [ ] **Step 6: Commit the release assets**

```powershell
git add client/play-store
git commit -m "chore: add Play Store release graphics"
```

### Task 2: Verify and build the Android release

**Files:**
- Verify: `client/android/app/build.gradle`
- Verify: `client/android/app/src/main/AndroidManifest.xml`
- Local-only: `client/android/key.properties`
- Produce: `client/android/app/build/outputs/bundle/release/app-release.aab`

**Interfaces:**
- Consumes: the existing Capacitor Android project and an upload keystore outside the repository.
- Produces: a signed AAB for Play testing tracks.

- [ ] **Step 1: Verify package, version, SDK, signing wiring, and permissions**

Run:

```powershell
rg "applicationId|versionCode|versionName|targetSdk|signingConfig|USE_EXACT_ALARM|USE_FULL_SCREEN_INTENT|AD_ID" client/android
```

Expected: `com.altijwal.prayer`, versionCode 1, versionName 1.0, target SDK 36, alarm permissions present, and no AD_ID permission.

- [ ] **Step 2: Run server tests**

```powershell
npm --prefix server test
```

Expected: Vitest exits 0.

- [ ] **Step 3: Build and type-check the client**

```powershell
npm --prefix client run build
```

Expected: TypeScript/native checks and Vite build exit 0.

- [ ] **Step 4: Verify the web bundle isolation gate**

```powershell
findstr /m astronomy client\dist\assets\*.js
```

Expected: only the lazy native `api-*.js` chunk matches.

- [ ] **Step 5: Synchronise Capacitor**

```powershell
cd client
npx cap sync android
```

Expected: Android assets and plugins synchronise without errors.

- [ ] **Step 6: Obtain signing credentials through secure user entry if absent**

Expected: `D:\keys\prayer-upload.jks` and gitignored `client/android/key.properties` exist; no secret value appears in logs or committed files.

- [ ] **Step 7: Build the signed AAB**

```powershell
cd client\android
.\gradlew.bat bundleRelease
```

Expected: `app-release.aab` exists and Gradle reports `BUILD SUCCESSFUL`.

### Task 3: Finish Play Console metadata and content declarations

**Files:**
- Upload: `client/public/icons/icon-512.png`
- Upload: `client/play-store/feature-graphic.png`
- Upload: four `client/play-store/phone-*.png` files

**Interfaces:**
- Consumes: verified metadata from `docs/PLAY_RELEASE.md` and Task 1 assets.
- Produces: completed 11/11 app setup tasks in Play Console.

- [ ] **Step 1: Complete the IARC category step**

Enter `contact@al-tijwal.com`, choose `All other app types`, accept IARC terms under the user's authorization, and select Next.

- [ ] **Step 2: Complete the IARC questionnaire**

Answer No to all content questions and all interactive-element questions, review the Everyone/PEGI 3-equivalent result, and save.

- [ ] **Step 3: Correct the store contact email**

Set public email to `contact@al-tijwal.com` and website to `https://prayer.altijwal.com`.

- [ ] **Step 4: Upload required listing graphics**

Upload the 512 icon, feature graphic, and four phone screenshots. Skip optional video, Chromebook, XR, and dedicated tablet screenshots unless Console blocks saving.

- [ ] **Step 5: Save and verify the listing**

Expected: Dashboard reports 11 of 11 setup tasks complete.

### Task 4: Upload the release and start testing

**Files:**
- Upload: `client/android/app/build/outputs/bundle/release/app-release.aab`

**Interfaces:**
- Consumes: the signed AAB and completed Play setup.
- Produces: an internal or closed-testing release and its opt-in link.

- [ ] **Step 1: Create an internal testing release**

Upload the AAB, use release name `1.0`, add concise Arabic/English release notes, and save the release.

- [ ] **Step 2: Complete permission declarations exposed by the AAB**

Declare exact alarms and full-screen intent as core alarm functionality using the approved wording in `docs/PLAY_RELEASE.md`.

- [ ] **Step 3: Create the closed-testing track**

Reuse the verified AAB and prepare the tester list. Do not fabricate tester addresses.

- [ ] **Step 4: Handoff tester recruitment**

Expected: the user supplies at least 12 real tester Google accounts; keep all opted in for 14 consecutive days.

- [ ] **Step 5: Verify no production submission occurred**

Expected: Production remains locked until closed-testing and production-access requirements are satisfied.
