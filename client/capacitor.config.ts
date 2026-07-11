import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor native shell config. The web assets are the SAME `vite build` output
// (webDir: dist); the native layer only adds the PrayerAlarm plugin.
// `appName` is the user-visible launcher label (approved 2026-07-11). The actual
// Android label lives in android/app/src/main/res/values/strings.xml (app_name);
// this value is used when regenerating the platform.
const config: CapacitorConfig = {
  appId: "com.altijwal.prayer",
  appName: "مواقيت الصلاة",
  webDir: "dist",
  android: {
    // App is served from https://localhost inside the WebView; the backend geo
    // endpoints are reached absolutely (see client/src/lib/api.ts) with CORS.
    allowMixedContent: false,
  },
};

export default config;
