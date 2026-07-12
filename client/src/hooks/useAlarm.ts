// Raises the full-screen AlarmOverlay when an alarm-kind reminder fires. Two
// trigger channels (see docs/NOTIFICATIONS.md):
//   1. A service-worker `message` ({ type: "prayer-alarm", payload }) — sent when
//      an alarm push arrives while the app is open, or when the user taps an alarm
//      notification (the SW focuses + posts).
//   2. A cold-open URL `?alarm=<prayer>&t=<firedAt>` — the SW opens this when no
//      client was alive to receive the message.
// Both are guarded against stale alarms (older than 5 min) so a frozen background
// PWA or an old deep-link can't blast a siren at the wrong time.

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ALERT_TARGET_LABEL } from "@/lib/alert-targets";
import type { AlertTarget } from "@/types/api";

const STALE_MS = 5 * 60_000;

export interface AlarmContent {
  title: string;
  body: string;
  /** The adhan/window instant the alarm anchors to (epoch ms), when known. */
  anchorAt?: number | null;
}

export interface UseAlarm {
  alarm: AlarmContent | null;
  dismiss: () => void;
}

interface AlarmMessage {
  type: string;
  payload?: {
    title?: string;
    body?: string;
    prayer?: string;
    firedAt?: number;
    /** Optional adhan instant for the overlay's countdown-to-adhan element. */
    anchorAt?: number;
  };
}

const KNOWN_TARGETS = new Set(Object.keys(ALERT_TARGET_LABEL));

export function useAlarm(): UseAlarm {
  const { t } = useI18n();
  const [alarm, setAlarm] = useState<AlarmContent | null>(null);

  const dismiss = useCallback(() => setAlarm(null), []);

  // Channel 1 — service-worker messages.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    const onMessage = (event: MessageEvent<AlarmMessage>) => {
      const data = event.data;
      if (!data || data.type !== "prayer-alarm") return;
      const p = data.payload ?? {};
      if (p.firedAt != null && Date.now() - p.firedAt > STALE_MS) return; // stale
      setAlarm({
        title: p.title || t("next.now"),
        body: p.body || "",
        anchorAt: typeof p.anchorAt === "number" ? p.anchorAt : null,
      });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [t]);

  // Channel 2 — cold-open `?alarm=<prayer>&t=<firedAt>`, consumed once on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prayer = params.get("alarm");
    if (!prayer) return;
    const firedAt = Number(params.get("t"));
    // Optional `a=<anchorAt>` — the adhan instant, appended by the native
    // AlarmActivity deep link for the countdown-to-adhan element.
    const anchor = Number(params.get("a"));
    const fresh = !Number.isFinite(firedAt) || Date.now() - firedAt <= STALE_MS;
    if (fresh && KNOWN_TARGETS.has(prayer)) {
      setAlarm({
        title: t(ALERT_TARGET_LABEL[prayer as AlertTarget]),
        body: t("next.now"),
        anchorAt: Number.isFinite(anchor) ? anchor : null,
      });
    }
    // Strip the params so a refresh doesn't re-raise the alarm.
    const url = new URL(window.location.href);
    url.searchParams.delete("alarm");
    url.searchParams.delete("t");
    url.searchParams.delete("a");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { alarm, dismiss };
}
