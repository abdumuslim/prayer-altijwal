// Android hardware back-button handling for the native app
// (docs/NATIVE_ALARM_FIXES_SPEC.md §2b). @capacitor/app registers an
// always-enabled back callback that, with no JS listener and no web history,
// does nothing — so back was a dead no-op. Registering a listener suppresses
// that default and lets the app close its top-most overlay, or minimize at root.
// No-op on web.

import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import { isNative } from "@/lib/native";

/**
 * Route the Android back press. `handler` returns true when it consumed the
 * press (e.g. closed an overlay); false means we're at the root screen → the app
 * is minimized (stock Android root-back: task to background, warm resume).
 */
export function useAndroidBack(handler: () => boolean): void {
  const ref = useRef(handler);
  // Keep the ref pointing at the freshest closure (updated after each render, not
  // during it) so the once-registered listener always sees current overlay state.
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    if (!isNative()) return;
    const listener = CapApp.addListener("backButton", () => {
      if (!ref.current()) void CapApp.minimizeApp();
    });
    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);
}
