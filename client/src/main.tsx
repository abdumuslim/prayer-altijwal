import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isNative } from "@/lib/native";

// DEV-only design preview (?design=N) — lazy so it is code-split and the chunk
// is never even requested in production builds.
const DesignPreview = lazy(() => import("./design-preview/DesignPreview"));
const designParam = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get("design")
  : null;

// DEV-only theme steering (docs/V2_REDESIGN_SPEC.md Phase 1): `?theme=X` forces
// a theme (overriding the persisted one) and the `T` key cycles themes live on
// ANY screen — the approval loop for the Phase-2/7 skins. Production ignores both.
if (import.meta.env.DEV) {
  const themeParam = new URLSearchParams(window.location.search).get("theme");
  const ids = ["night", "glass", "material", "contrast"];
  if (themeParam && ids.includes(themeParam)) {
    document.documentElement.dataset.theme = themeParam;
  }
  window.addEventListener("keydown", (e) => {
    if (e.key !== "t" && e.key !== "T") return;
    const el = document.documentElement;
    const cur = ids.indexOf(el.dataset.theme ?? "night");
    el.dataset.theme = ids[(cur + 1) % ids.length];
  });
}

// Liquid-Glass lensing gate: `backdrop-filter: url(#svg-filter)` renders ONLY in
// Chromium (Android WebView + Chrome — our native shell and dominant web target;
// WebKit bug 245510 / Firefox no-op silently LOSE the blur if fed url()). The
// glass theme scopes its feDisplacementMap rules to html[data-lens="1"] so other
// engines keep the plain blur+saturate recipe untouched.
if (/Chrom(e|ium)|Edg\//.test(navigator.userAgent)) {
  document.documentElement.dataset.lens = "1";
}

// Android system font scale (native only): MainActivity applies it as WebView
// textZoom (capped 130%), which scales RENDERED text without touching CSS —
// the px-fixed hero/TopBar geometry would wrap/collide with no compensation.
// Detect the effective zoom (DOM width vs canvas width — canvas text ignores
// textZoom) and stamp data-syszoom so the same fs125-* layout compensations
// apply, and applyFontScale suppresses the in-app CSS step (combined ≤ ~130%,
// docs/V2_REDESIGN_SPEC.md Phase 8.5).
if (isNative()) {
  try {
    const probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;visibility:hidden;white-space:nowrap;font:16px monospace;";
    probe.textContent = "0123456789abcdef";
    document.body.appendChild(probe);
    const domWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx && domWidth > 0) {
      ctx.font = "16px monospace";
      const zoom = domWidth / ctx.measureText("0123456789abcdef").width;
      if (zoom > 1.15) {
        document.documentElement.dataset.syszoom = "high";
        // System zoom already scales everything — never stack the CSS step on top.
        delete document.documentElement.dataset.fontScale;
      }
    }
  } catch {
    // measurement is best-effort; worst case the compensations just don't apply
  }
}

// Register the service worker (push + offline shell). Best-effort. Skipped in the
// native (Capacitor) app, which uses on-device scheduling instead of web push.
// The offline engine + alarm scheduler load lazily via loadNativeFacade() (see
// @/lib/native) when a native hook first needs them — kept out of the web bundle.
if ("serviceWorker" in navigator && !isNative()) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

// The UI is LOCKED to Arabic — we always render `ar`, ignoring any stored
// preference or the browser language (there is no language picker). The English
// dictionaries + i18n machinery remain in the codebase for future use; to
// re-enable user-switching, restore the stored-preference lookup here (read
// `loadState().language`) and bring back the picker in SettingsPanel.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider initialLang="ar">
        {designParam ? (
          <Suspense fallback={null}>
            <DesignPreview initial={Number(designParam) || 1} />
          </Suspense>
        ) : (
          <App />
        )}
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
