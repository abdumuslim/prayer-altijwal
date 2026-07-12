// Offline monthly table for the native (Capacitor) app — docs/V2_REDESIGN_SPEC.md
// Phase 5. Imports the server's buildMonthPayload VERBATIM (one implementation,
// both sides — same mechanism as local-times.ts → payload.ts), so the on-device
// table matches GET /api/prayer-times/month exactly (proven by month.test.ts).
// Reached only from the native-only chunk; never in the web bundle.

import { describeMethod, detectMethod } from "../../../server/src/prayer/method-detect.js";
import {
  buildMonthPayload,
  type MonthPayload,
} from "../../../server/src/prayer/month-payload.js";
import type { AsrMadhab, MethodName } from "../../../server/src/prayer-engine/index.js";
import type { Lang } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

export interface LocalMonthInput {
  location: StoredLocation;
  lang: Lang;
  /** Explicit method override; ignored when methodAuto is true. */
  method?: string | null;
  methodAuto: boolean;
  asr?: AsrMadhab | null;
  /** Target month, YYYY-MM. */
  month: string;
}

/** Compute the monthly table on-device — mirrors the /month route resolution. */
export function computeLocalMonth(input: LocalMonthInput): MonthPayload {
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

  return buildMonthPayload({
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
    month: input.month,
  });
}
