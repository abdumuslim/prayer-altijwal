import {
  calculatePrayerTimes,
  type AsrMadhab,
  type MethodName,
  type PrayerTimesResult,
} from "../prayer-engine/index.js";

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
 * fallback when no per-location elevation is available. BaghdadYMA's +5/+3/+2
 * calibration is elevation-robust: Baghdad's real ~41 m ≈ the baked 34 m (anchor
 * unchanged), while higher/lower governorates — Mosul 228 m, Kirkuk 346 m, Basra
 * 4 m — now get correct rise/set instead of being computed at Baghdad's altitude.
 * (The official Waqf table uses each city's own elevation; matching it improves
 * the calculated fallback. The exact poster numbers come from the official-data
 * layer; the formula is the GPS-portable best-effort for everywhere else.)
 */
export function computePrayerTimes(input: ComputeInput): PrayerTimesResult {
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
    },
  );
}
