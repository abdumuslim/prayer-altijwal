// Keeps the OS-level alarm set in sync with the device's local rules (native app
// only). Recomputes the 7-day alarm plan and calls PrayerAlarm.replaceAll on any
// change to rules / location / tone / method, and again whenever the app returns
// to the foreground (so a stale horizon is topped up). No-op on web.

import { useEffect, useMemo, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import {
  isNative,
  loadNativeFacade,
  PrayerAlarm,
  type NativeScheduleInput,
} from "@/lib/native";
import type { LocalAlertRule } from "@/lib/local-alerts";
import type { StoredLocation } from "@/lib/storage";
import type { AsrMadhab, Lang } from "@/types/api";

interface Params {
  location: StoredLocation | null;
  lang: Lang;
  method: string | null;
  methodAuto: boolean;
  asr: AsrMadhab | null;
  toneId: string;
  rules: LocalAlertRule[];
}

export function useNativeAlarmScheduler(params: Params): void {
  const [resumeNonce, setResumeNonce] = useState(0);

  // Re-schedule when the app returns to the foreground (top up the horizon).
  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) setResumeNonce((n) => n + 1);
    }).then((handle) => {
      remove = () => void handle.remove();
    });
    return () => remove?.();
  }, []);

  const sig = useMemo(() => {
    if (!params.location) return null;
    return JSON.stringify({
      lat: params.location.lat.toFixed(4),
      lon: params.location.lon.toFixed(4),
      tz: params.location.tz,
      method: params.methodAuto ? "auto" : params.method,
      asr: params.asr,
      lang: params.lang,
      tone: params.toneId,
      rules: params.rules,
    });
  }, [params.location, params.method, params.methodAuto, params.asr, params.lang, params.toneId, params.rules]);

  useEffect(() => {
    if (!isNative() || !params.location) return;
    let cancelled = false;
    void (async () => {
      const facade = await loadNativeFacade();
      const loc = params.location;
      if (!facade || cancelled || !loc) return;
      const input: NativeScheduleInput = {
        location: loc,
        lang: params.lang,
        method: params.method,
        methodAuto: params.methodAuto,
        asr: params.asr,
        toneId: params.toneId,
        rules: params.rules,
      };
      try {
        const alarms = facade.computeSchedule(input);
        await PrayerAlarm.replaceAll({ alarms });
      } catch {
        // plugin unavailable / permission denied — the onboarding UI surfaces this
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, resumeNonce]);
}
