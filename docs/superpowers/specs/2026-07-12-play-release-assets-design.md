---
type: Runbook
title: 'Play Release Assets Design'
description: 'Complete the Google Play setup for com.altijwal.prayer using the existing app, brand artwork, and real Android UI. Do not redesign the product or introduce mock app screens.'
tags: [prayer, claude-code, current]
maintainer: claude-code
timestamp: 2026-07-27
---

# Play Release Assets Design

## Goal

Complete the Google Play setup for `com.altijwal.prayer` using the existing app, brand artwork, and real Android UI. Do not redesign the product or introduce mock app screens.

## Store assets

- Use `client/public/icons/icon-512.png` as the Play icon.
- Build a deterministic 1024×500 feature graphic from the existing night-brand background and `client/assets/icon-only.png`. The output must be a flattened RGB PNG without transparency.
- Capture or select four real Android screenshots showing the main prayer screen, reminder settings, full-screen alarm, and optional worship features.
- Crop final phone screenshots to 1080×1920, preserving legible UI and avoiding device frames or fabricated content.

## Console metadata

- Keep Arabic as the default listing language and use the approved Arabic descriptions in `docs/PLAY_RELEASE.md`.
- Use Lifestyle as the category, `contact@al-tijwal.com` as the public contact, and `https://prayer.altijwal.com` as the website.
- Complete the IARC questionnaire as an Other/utility app with all content and interactive-element questions answered No.
- Keep the previously saved privacy, access, ads, target-audience, government, financial, health, and data-safety declarations consistent with the runbook.

## Release bundle and testing

- Verify the web/native builds and server tests before producing the release bundle.
- Use Play App Signing with a local upload key outside the repository. Never print, commit, or expose passwords.
- Upload the first signed AAB to an internal or closed-testing release when signing is available.
- Do not submit a production rollout before the required closed test and production-access approval.

## Safety and verification

- Preserve unrelated working-tree files.
- Validate image dimensions, colour mode, and file size before upload.
- Confirm the release bundle package, version, signing, and absence of advertising ID before upload.
- Treat OTP, payment, identity verification, and secret-entry screens as user handoff points.
