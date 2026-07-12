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
