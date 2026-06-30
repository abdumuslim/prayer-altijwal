import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Register the service worker (push + offline shell). Best-effort.
if ("serviceWorker" in navigator) {
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
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
