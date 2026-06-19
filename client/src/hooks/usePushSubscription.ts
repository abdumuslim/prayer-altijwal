// Web-push subscription lifecycle: permission, subscribe/unsubscribe, status,
// and the active endpoint (used to key the device's reminder rules). The actual
// reminders live server-side as alert rules — see usePrayerAlerts.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getExistingSubscription,
  iosNeedsInstall,
  pushSupported,
  subscribe as doSubscribe,
  unsubscribe as doUnsubscribe,
} from "@/lib/push";
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
  error: string | null;
  /** The active push endpoint (keys the device's reminder rules); null if off. */
  endpoint: string | null;
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
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reflect any pre-existing subscription on mount.
  useEffect(() => {
    let cancelled = false;
    if (!pushSupported()) return;
    void getExistingSubscription().then((sub) => {
      if (cancelled) return;
      if (sub && Notification.permission === "granted") {
        setEndpoint(sub.endpoint);
        setStatus("subscribed");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const sub = await doSubscribe({
        lat: ctx.location.lat,
        lon: ctx.location.lon,
        tz: ctx.location.tz,
        country: ctx.location.country,
        method: ctx.method,
        asr: ctx.asr,
        lang: ctx.lang,
      });
      setEndpoint(sub.endpoint);
      setStatus("subscribed");
    } catch (err) {
      if (Notification.permission === "denied") {
        setStatus("denied");
      } else {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Subscription failed");
      }
    }
  }, [ctx.location, ctx.method, ctx.asr, ctx.lang]);

  const disable = useCallback(async () => {
    setError(null);
    setStatus("working");
    try {
      await doUnsubscribe();
    } finally {
      setEndpoint(null);
      setStatus(pushSupported() ? "default" : "unsupported");
    }
  }, []);

  // Keep the stored subscription fresh: when the user changes location/method/
  // language while subscribed, re-upsert so reminders use the latest context.
  const sig = `${ctx.location?.lat},${ctx.location?.lon},${ctx.location?.tz},${ctx.method},${ctx.asr},${ctx.lang}`;
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "subscribed" || !ctx.location) return;
    if (lastSig.current === null) {
      lastSig.current = sig; // first observation after (re)subscribe — no resync
      return;
    }
    if (lastSig.current === sig) return;
    lastSig.current = sig;
    void doSubscribe({
      lat: ctx.location.lat,
      lon: ctx.location.lon,
      tz: ctx.location.tz,
      country: ctx.location.country,
      method: ctx.method,
      asr: ctx.asr,
      lang: ctx.lang,
    }).catch(() => undefined); // best-effort refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, status]);

  return { status, error, endpoint, enable, disable };
}
