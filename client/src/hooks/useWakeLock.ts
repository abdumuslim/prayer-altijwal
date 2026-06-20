// Keeps the device screen awake while the app is open (Screen Wake Lock API).
// The browser auto-releases the lock when the tab is hidden, so we re-acquire on
// `visibilitychange` (same pattern as usePrayerTimes' refocus listener). Silently
// no-ops where unsupported (older iOS, power-saver) — the screen just sleeps as
// usual, nothing is surfaced. No UI: the lock is held for the app's whole life.

import { useEffect } from "react";

// `wakeLock` is standard but not in every TS DOM lib; describe the slice we use
// and cast (codebase precedent: lib/push.ts:isStandalone).
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export function useWakeLock(): void {
  useEffect(() => {
    const wakeLock = (navigator as unknown as { wakeLock?: WakeLockLike })
      .wakeLock;
    if (!wakeLock) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async (): Promise<void> => {
      if (cancelled || document.visibilityState !== "visible") return;
      if (sentinel) return; // already holding a lock
      try {
        const next = await wakeLock.request("screen");
        if (cancelled) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        // request can reject (no user activation, power-saver) — ignore.
      }
    };

    const onVisible = (): void => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    };
  }, []);
}
