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

// Initial language: the user's stored choice if any, otherwise ALWAYS Arabic
// (the product default — independent of the browser's language).
function initialLang(): Lang {
  const stored = loadState().language;
  return stored === "ar" || stored === "en" ? stored : "ar";
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
