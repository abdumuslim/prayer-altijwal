import {
  calculatePrayerTimes,
  type AsrMadhab,
  type MethodName,
  type PrayerTimesResult,
} from "../prayer-engine/index.js";
import { iraqCalibration } from "./iraq-calibration.js";

export interface ComputeInput {
  lat: number;
  lon: number;
  /** Metres above sea level (from the cities/governorate dataset or GPS). */
  elevation?: number;
  /** Target location's IANA timezone — anchors the civil day (hard rule 4). */
  tz: string;
  method: MethodName;
  asr?: AsrMadhab;
  /** Any instant within the civil day to compute. */
  date: Date;
}

/**
 * Thin wrapper over the verbatim engine. Always defaults the high-latitude rule
 * to "AngleBased" (hard rule 8) so users above ~48° never get an Invalid Date.
 *
 * Elevation: we pass the location's real elevation for EVERY method — including
 * the Iraqi BaghdadYMA profile — so the sunrise/sunset horizon dip is correct per
 * location. The method's baked-in `elevationMeters` (Baghdad's ~34 m) is only the
 * fallback when no per-location elevation is available.
 *
 * Iraqi calibration: for the nationwide BaghdadYMA profile we replace the method's
 * flat +5/+3/+2 offsets with the nearest governorate's per-prayer calibrated
 * offset + rounding (`iraq-calibration.ts`, fit to the official ديوان الوقف السني
 * table — ~83% exact-to-the-minute, 99.4% within ±1). For a LITERAL 0-min match on
 * digitized dates, `payload.ts` overlays the official poster numbers verbatim
 * (`iraqExactTimes`); this calibrated formula is the best-effort everywhere else.
 */
export function computePrayerTimes(input: ComputeInput): PrayerTimesResult {
  const cal = input.method === "BaghdadYMA" ? iraqCalibration(input.lat, input.lon) : null;
  return calculatePrayerTimes(
    {
      latitude: input.lat,
      longitude: input.lon,
      elevation: input.elevation,
    },
    input.date,
    {
      method: input.method,
      asr: input.asr,
      timezone: input.tz,
      highLatitudeRule: "AngleBased",
      ...(cal ? { adjustments: cal.adjustments, rounding: cal.rounding } : {}),
    },
  );
}
