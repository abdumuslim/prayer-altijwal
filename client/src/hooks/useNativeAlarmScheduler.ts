// Keeps the OS-level alarm set in sync with the device's local rules (native app
// only). Recomputes the 7-day alarm plan and calls PrayerAlarm.replaceAll on any
// change to rules / location / tone / method, and again whenever the app returns
// to the foreground (so a stale horizon is topped up). No-op on web.

import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapApp } from "@capacitor/app";
import {
  isNative,
  loadNativeFacade,
  PrayerAlarm,
  type AlarmTexts,
  type NativeScheduleInput,
  type ReplaceAllResult,
} from "@/lib/native";
import { recordError } from "@/lib/error-log";
import { ar } from "@/i18n/strings.ar";
import { en } from "@/i18n/strings.en";
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

/** Localized native-notification strings for this sync (docs/NATIVE_ALARM_RELIABILITY_SPEC.md §4). */
function buildAlarmTexts(lang: Lang): AlarmTexts {
  const d = lang === "ar" ? ar : en;
  return {
    preTitle: d["alarm.preTitle"],
    preBody: d["alarm.preBody"],
    preAction: d["alarm.preAction"],
    preStopped: d["alarm.preStopped"],
    missedTitle: d["alarm.missedTitle"],
    missedRang: d["alarm.missedRang"],
    missedNotFired: d["alarm.missedNotFired"],
    refreshTitle: d["alarm.refreshTitle"],
    refreshBody: d["alarm.refreshBody"],
  };
}

/**
 * Surface the AlarmScheduler UID-cap drop (docs/NATIVE_ALARM_RELIABILITY_SPEC.md P6):
 * occurrences beyond ~500/UID are silently dropped natively while replaceAll still
 * reports success, so a rule set that overflows the cap loses far-out alarms with no
 * sign. Make it observable without any UI: a ring-buffer entry (pullable off the
 * device) plus the same logcat channel the rest of this sync already uses. `result`
 * may be undefined against an older native build that resolved void; treat that as
 * "no drop".
 */
function reportCapDrop(result: ReplaceAllResult | undefined): void {
  if (!result || result.dropped <= 0) return;
  const extra = { requested: result.requested, armed: result.armed, dropped: result.dropped };
  recordError({
    kind: "native-alarm-cap",
    message: `alarm UID cap: armed ${result.armed}/${result.requested}, dropped ${result.dropped}`,
    extra,
  });
  console.error("[native-alarm] UID cap dropped occurrences", extra);
}

export function useNativeAlarmScheduler(params: Params): void {
  const [resumeNonce, setResumeNonce] = useState(0);
  // Monotonic generation: each sync captures the current value and, after any
  // await, bails if a newer sync (or unmount) has since bumped it — a stale
  // in-flight replaceAll must never overwrite a newer set (§3f).
  const genRef = useRef(0);

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

  // A phone left foregrounded for days never fires appStateChange, so also top
  // up the 7-day horizon on a 6-hour cadence while mounted (native only) (§3f).
  useEffect(() => {
    if (!isNative()) return;
    const id = setInterval(() => setResumeNonce((n) => n + 1), 6 * 60 * 60 * 1000);
    return () => clearInterval(id);
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
    const gen = ++genRef.current;
    const isStale = () => genRef.current !== gen;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function sync(isRetry: boolean): Promise<void> {
      const facade = await loadNativeFacade();
      if (isStale()) return; // after the facade-load await
      const loc = params.location;
      if (!facade || !loc) return;
      const input: NativeScheduleInput = {
        location: loc,
        lang: params.lang,
        method: params.method,
        methodAuto: params.methodAuto,
        asr: params.asr,
        toneId: params.toneId,
        rules: params.rules,
      };
      const texts = buildAlarmTexts(params.lang);
      try {
        const alarms = facade.computeSchedule(input); // sync compute
        if (isStale()) return; // immediately before replaceAll
        const result = await PrayerAlarm.replaceAll({ alarms, texts });
        if (isStale()) return; // immediately after replaceAll
        reportCapDrop(result);
      } catch (err) {
        // Surface failures (plugin unavailable / permission denied / compute
        // throw) in logcat instead of hiding them — a silent catch here masked
        // the original "no alarms armed" bug (docs/NATIVE_ALARM_FIXES_SPEC.md §2a).
        console.error("[native-alarm] replaceAll failed", err);
        // One retry ~5s later, same generation only (§3f).
        if (!isRetry) {
          retry = setTimeout(() => {
            if (!isStale()) void sync(true);
          }, 5000);
        }
      }
    }
    void sync(false);

    return () => {
      genRef.current += 1; // invalidate any in-flight sync
      if (retry) clearTimeout(retry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, resumeNonce]);
}
