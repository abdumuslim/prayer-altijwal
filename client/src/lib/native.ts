// Capacitor bridge: platform detection + the typed PrayerAlarm plugin handle.
// Safe to import from anywhere in the web bundle — @capacitor/core is tiny and
// web-compatible (isNativePlatform() is false in a browser), and registerPlugin
// is lazy (the native plugin only resolves when a method is actually called).
// The heavy offline engine lives behind a dynamic import (native/boot.ts), NOT
// here, so importing this file never pulls the engine into the web bundle.

import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { AsrMadhab, Lang, PrayerTimesResponse } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";
import type { LocalAlertRule } from "@/lib/local-alerts";

/** True only inside the Capacitor native shell (Android/iOS), false on web/PWA. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Current native platform id ("android" | "ios" | "web"). */
export function nativePlatform(): string {
  return Capacitor.getPlatform();
}

/** One scheduled on-device alarm instant (docs/NATIVE_ALARM_SPEC.md §3d). */
export interface ScheduledAlarm {
  /** `${dateKey}-r${ruleId}-${target}` — same convention as the server fireKey. */
  id: string;
  /** Fire time, epoch ms. */
  at: number;
  kind: "alarm" | "notification";
  /** Prebuilt localized text — native renders it verbatim. */
  title: string;
  body: string;
  /** AlarmSound id → public/alarms/<file> (alarm kind only). */
  toneId: string;
  /** AlertTarget, used for the ?alarm=<target> deep link. */
  target: string;
  /**
   * The anchor (adhan/window) instant itself, epoch ms — after `at` for
   * "before" rules. The native ring screen ticks a live countdown to it.
   */
  anchorAt: number;
  /** Prebuilt localized countdown label (the hero's "next.header" string). */
  untilLabel: string;
}

export interface PrayerAlarmState {
  notifications: "granted" | "denied" | "prompt";
  exactAlarm: boolean;
  fullScreen: boolean;
  batteryExempt: boolean;
}

/** One selectable system (device) alarm tone. id = `device:<content-uri>`. */
export interface DeviceTone {
  id: string;
  /** System-localized display name (e.g. "Cesium"). */
  title: string;
}

export interface PrayerAlarmPlugin {
  /** Cancel every previously-armed alarm, then arm exactly this set. Idempotent. */
  replaceAll(options: { alarms: ScheduledAlarm[] }): Promise<void>;
  cancelAll(): Promise<void>;
  getState(): Promise<PrayerAlarmState>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;
  openFullScreenIntentSettings(): Promise<void>;
  openBatterySettings(): Promise<void>;
  /** The device's system alarm tones (RingtoneManager TYPE_ALARM). */
  listDeviceTones(): Promise<{ tones: DeviceTone[] }>;
  /** Preview a `device:` tone natively (webview audio can't reach content://). */
  previewTone(options: { id: string }): Promise<void>;
  stopTonePreview(): Promise<void>;
  /**
   * Theme appearance bridge (docs/V2_REDESIGN_SPEC.md Phase 1 + 7): flips the
   * system-bar icon style at runtime, sets the window backdrop color, and
   * persists the theme's alarm-screen palette (AppearanceStore) so the native
   * AlarmActivity follows the active theme even when the app is killed.
   */
  setAppearance(options: {
    systemBarsLight: boolean;
    bg: string;
    alarm?: { bg: string; ink: string; inkDim: string; accent: string };
  }): Promise<void>;
}

/**
 * The native PrayerAlarm plugin (implemented in client/android for Android;
 * iOS/AlarmKit in a later phase). On web it is a no-op stub that rejects, so
 * always guard calls with isNative().
 */
export const PrayerAlarm = registerPlugin<PrayerAlarmPlugin>("PrayerAlarm");

// ── Compass plugin (docs/QIBLA_MASJID_SPEC.md §5b) ───────────────────────────

/** One fused-sensor heading sample from the native CompassPlugin. */
export interface CompassHeadingEvent {
  /** Degrees CW from TRUE north (declination applied, display-rotation remapped). */
  trueHeading: number;
  magneticHeading: number;
  declination: number;
  accuracy: "high" | "medium" | "low" | "unreliable";
  /** Which sensor path the device landed on — budget phones have no gyroscope
   *  and fall back from the rotation vector (see CompassPlugin.java). */
  source?: "rotation-vector" | "geomagnetic-rv" | "accel-mag";
}

export interface CompassPluginContract {
  /** Start heading events (~20 Hz). lat/lon/alt feed declination. Resolves with
   *  the sensor path that was selected. */
  start(options: { lat: number; lon: number; alt?: number }): Promise<{ source?: string }>;
  stop(): Promise<void>;
  /** Subtle confirmation haptic for qibla lock-on (no permission needed). */
  pulse(): Promise<void>;
  addListener(
    eventName: "heading",
    listener: (event: CompassHeadingEvent) => void,
  ): Promise<PluginListenerHandle>;
}

/**
 * The native Compass plugin (app-local Java class, separate from PrayerAlarm —
 * do not bloat the alarm plugin). Web callers must guard with isNative().
 */
export const Compass = registerPlugin<CompassPluginContract>("Compass");

// ── Native offline facade (implemented in the lazy native chunk) ─────────────
// The heavy offline engine lives in src/native/** (loaded via import.meta.glob so
// the strict app tsconfig + web bundle stay engine-free). These app-space types
// describe that chunk's contract; the shapes match src/native/local-times.ts and
// src/native/schedule.ts structurally, so app hooks call them through NativeFacade.

export interface NativeLocalTimesInput {
  location: StoredLocation;
  lang: Lang;
  method?: string | null;
  methodAuto: boolean;
  asr?: AsrMadhab | null;
  date?: string;
  now?: Date;
}

export interface NativeScheduleInput {
  location: StoredLocation;
  lang: Lang;
  method?: string | null;
  methodAuto: boolean;
  asr?: AsrMadhab | null;
  toneId: string;
  rules: LocalAlertRule[];
  now?: Date;
}

export interface NativeFacade {
  computeLocalPrayerTimes(input: NativeLocalTimesInput): PrayerTimesResponse;
  computeSchedule(input: NativeScheduleInput): ScheduledAlarm[];
}

/**
 * Dynamically load the native offline chunk. Uses import.meta.glob so the strict
 * app tsconfig never resolves the engine sources (they are checked by
 * tsconfig.native) and Vite code-splits them out of the web bundle. Returns null
 * off-native or if the chunk is unavailable.
 */
export async function loadNativeFacade(): Promise<NativeFacade | null> {
  if (!isNative()) return null;
  const mods = import.meta.glob("../native/api.ts");
  const load = Object.values(mods)[0];
  if (!load) return null;
  const mod = (await load()) as unknown as NativeFacade;
  return mod;
}
