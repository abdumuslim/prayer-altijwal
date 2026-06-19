import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { loadState } from "@/lib/storage";
import type { Lang } from "@/types/api";

// Register the service worker (push + offline shell). Best-effort.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

// Initial language: stored value → navigator.language → default "ar".
function initialLang(): Lang {
  const stored = loadState().language;
  if (stored === "ar" || stored === "en") return stored;
  const nav = navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("en") ? "en" : "ar";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <I18nProvider initialLang={initialLang()}>
        <App />
      </I18nProvider>
    </ErrorBoundary>
  </StrictMode>,
);
