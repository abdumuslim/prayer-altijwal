import {
  calculatePrayerTimes,
  type AsrMadhab,
  type MethodName,
  type PrayerTimesResult,
} from "../prayer-engine/index.js";

export interface ComputeInput {
  lat: number;
  lon: number;
  /** Metres above sea level (from the cities dataset). Ignored for BaghdadYMA. */
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
 * Elevation: for BaghdadYMA we deliberately let the method's baked-in 34 m win
 * (the calibration was fitted at 34 m) by NOT passing coords.elevation; for every
 * other method we pass the dataset elevation so rise/set are elevation-correct.
 */
export function computePrayerTimes(input: ComputeInput): PrayerTimesResult {
  const useDatasetElevation = input.method !== "BaghdadYMA" && input.elevation != null;
  return calculatePrayerTimes(
    {
      latitude: input.lat,
      longitude: input.lon,
      elevation: useDatasetElevation ? input.elevation : undefined,
    },
    input.date,
    {
      method: input.method,
      asr: input.asr,
      timezone: input.tz,
      highLatitudeRule: "AngleBased",
    },
  );
}
