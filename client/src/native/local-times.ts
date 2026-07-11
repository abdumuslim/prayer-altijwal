// Offline prayer-time computation for the native (Capacitor) app. Mirrors the
// server route (server/src/prayer/routes.ts) exactly — same method-detection and
// the same buildPrayerTimesPayload — so the on-device payload is byte-identical
// to what /api/prayer-times would return (proven by local-times.test.ts). The
// engine + wrappers are the REUSED server sources, imported via the @prayer* Vite
// aliases; only two Node-only spots are shimmed (see vite.config.ts).
//
// Reached only from the native-only chunk (client/src/native/boot.ts); never in
// the web bundle (amended hard rule 3).

import { describeMethod, detectMethod } from "../../../server/src/prayer/method-detect.js";
import {
  buildPrayerTimesPayload,
  type PrayerTimesPayload,
} from "../../../server/src/prayer/payload.js";
import type { AsrMadhab, MethodName } from "../../../server/src/prayer-engine/index.js";
import type { Lang } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

export interface LocalTimesInput {
  location: StoredLocation;
  lang: Lang;
  /** Explicit method override; ignored when methodAuto is true. */
  method?: string | null;
  methodAuto: boolean;
  asr?: AsrMadhab | null;
  /** Civil date (YYYY-MM-DD) in the location tz; default today. */
  date?: string;
  /** Injected clock for tests; defaults to new Date(). */
  now?: Date;
}

/**
 * Compute the full prayer-times payload on-device. The return type is the
 * server's PrayerTimesPayload, which is byte-compatible with the client's
 * PrayerTimesResponse (see docs/PRAYER_TIMES_API.md).
 */
export function computeLocalPrayerTimes(input: LocalTimesInput): PrayerTimesPayload {
  const { location, lang } = input;

  let methodKey: MethodName;
  let methodLabel: string;
  let asr: AsrMadhab;
  let auto: boolean;
  let baghdadCalibrated: boolean;

  const override = !input.methodAuto && input.method ? (input.method as MethodName) : null;
  if (override) {
    methodKey = override;
    const desc = describeMethod(methodKey);
    methodLabel = desc.label;
    asr = input.asr ?? desc.asr;
    auto = false;
    baghdadCalibrated = methodKey === "BaghdadYMA";
  } else {
    const det = detectMethod(location.country ?? undefined, location.lat, location.lon);
    methodKey = det.key;
    methodLabel = det.label;
    asr = input.asr ?? det.asr;
    auto = true;
    baghdadCalibrated = det.baghdadCalibrated;
  }

  return buildPrayerTimesPayload({
    lat: location.lat,
    lon: location.lon,
    elevation: location.elevation ?? undefined,
    tz: location.tz,
    lang,
    method: methodKey,
    methodLabel,
    asr,
    auto,
    baghdadCalibrated,
    city: location.city ?? undefined,
    country: location.country ?? undefined,
    date: input.date,
    now: input.now,
  });
}
