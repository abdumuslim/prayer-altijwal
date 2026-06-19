// Web-push subscription state: permission, subscribe/unsubscribe, prefs sync,
// iOS-standalone detection. Persists reminder prefs to the storage envelope.

import { useCallback, useEffect, useState } from "react";
import { updatePushPrefs } from "@/lib/api";
import {
  getExistingSubscription,
  iosNeedsInstall,
  pushSupported,
  subscribe as doSubscribe,
  unsubscribe as doUnsubscribe,
} from "@/lib/push";
import {
  DEFAULT_REMINDER_PREFS,
  loadState,
  patchState,
  type ReminderPrefs,
} from "@/lib/storage";
import type { AsrMadhab, Lang } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

export type PushStatus =
  | "unsupported"
  | "ios-install" // iOS, not yet added to home screen
  | "default" // supported, not yet subscribed
  | "subscribed"
  | "denied"
  | "working"
  | "error";

export interface UsePushSubscription {
  status: PushStatus;
  prefs: ReminderPrefs;
  error: string | null;
  setPrayers: (prayers: string[]) => void;
  setLeadMinutes: (mins: number[]) => void;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

interface Context {
  location: StoredLocation | null;
  method: string;
  asr: AsrMadhab;
  lang: Lang;
}

export function usePushSubscription(ctx: Context): UsePushSubscription {
  const [status, setStatus] = useState<PushStatus>(() => {
    if (!pushSupported()) return iosNeedsInstall() ? "ios-install" : "unsupported";
    if (Notification.permission === "denied") return "denied";
    return "default";
  });
  const [prefs, setPrefs] = useState<ReminderPrefs>(
    () => loadState().reminderPrefs ?? DEFAULT_REMINDER_PREFS,
  );
  const [error, setError] = useState<string | null>(null);

  // Reflect any pre-existing subscription on mount.
  useEffect(() => {
    let cancelled = false;
    if (!pushSupported()) return;
    void getExistingSubscription().then((sub) => {
      if (cancelled) return;
      if (sub && Notification.permission === "granted") setStatus("subscribed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistPrefs = useCallback((next: ReminderPrefs) => {
    setPrefs(next);
    patchState({ reminderPrefs: next });
  }, []);

  const pushPrefsToServer = useCallback(
    async (next: ReminderPrefs) => {
      if (status !== "subscribed") return;
      const sub = await getExistingSubscription();
      if (!sub) return;
      try {
        await updatePushPrefs({
          endpoint: sub.endpoint,
          prayers: next.prayers,
          leadMinutes: next.leadMinutes,
          method: ctx.method,
          asr: ctx.asr,
          lang: ctx.lang,
        });
      } catch {
        // best-effort; prefs are still stored locally
      }
    },
    [status, ctx.method, ctx.asr, ctx.lang],
  );

  const setPrayers = useCallback(
    (prayers: string[]) => {
      const next = { ...prefs, prayers };
      persistPrefs(next);
      void pushPrefsToServer(next);
    },
    [prefs, persistPrefs, pushPrefsToServer],
  );

  const setLeadMinutes = useCallback(
    (leadMinutes: number[]) => {
      const next = { ...prefs, leadMinutes };
      persistPrefs(next);
      void pushPrefsToServer(next);
    },
    [prefs, persistPrefs, pushPrefsToServer],
  );

  const enable = useCallback(async () => {
    setError(null);
    if (!pushSupported()) {
      setStatus(iosNeedsInstall() ? "ios-install" : "unsupported");
      return;
    }
    if (!ctx.location) {
      setError("Set your location first.");
      return;
    }
    setStatus("working");
    try {
      await doSubscribe({
        lat: ctx.location.lat,
        lon: ctx.location.lon,
        tz: ctx.location.tz,
        country: ctx.location.country,
        method: ctx.method,
        asr: ctx.asr,
        prayers: prefs.prayers,
        leadMinutes: prefs.leadMinutes,
        lang: ctx.lang,
      });
      const next = { ...prefs, enabled: true };
      persistPrefs(next);
      setStatus("subscribed");
    } catch (err) {
      if (Notification.permission === "denied") {
        setStatus("denied");
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Subscription failed");
      }
    }
  }, [ctx.location, ctx.method, ctx.asr, ctx.lang, prefs, persistPrefs]);

  const disable = useCallback(async () => {
    setError(null);
    setStatus("working");
    try {
      await doUnsubscribe();
    } finally {
      persistPrefs({ ...prefs, enabled: false });
      setStatus(pushSupported() ? "default" : "unsupported");
    }
  }, [prefs, persistPrefs]);

  return {
    status,
    prefs,
    error,
    setPrayers,
    setLeadMinutes,
    enable,
    disable,
  };
}
