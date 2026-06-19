import { METHODS, type MethodName } from "../prayer-engine/index.js";
import type { AsrMadhab } from "../prayer-engine/index.js";

// Country (ISO-3166 alpha-2) → calculation method. See DECISIONS.md ADR-002.
const COUNTRY_METHOD: Record<string, MethodName> = {
  EG: "Egyptian",
  SA: "UmmAlQura",
  TR: "Diyanet",
  US: "ISNA",
  CA: "ISNA",
  PK: "Karachi",
  IN: "Karachi",
  BD: "Karachi",
  AF: "Karachi",
  AE: "Dubai",
  QA: "Qatar",
  KW: "Kuwait",
  SG: "Singapore",
  MY: "Singapore",
  IR: "Tehran",
};

export interface DetectedMethod {
  key: MethodName;
  label: string;
  asr: AsrMadhab;
  /** True for Iraq — the calibrated Iraqi (Waqf) profile is in use. */
  baghdadCalibrated: boolean;
}

/**
 * Resolve the default calculation method for a location.
 *
 * Iraq (IQ): the calibrated Iraqi profile (BaghdadYMA — MWL 18°/17° angles,
 * Standard Asr, +5/+3/+2 offsets, fajr floor, observer at 34 m) is applied to
 * the WHOLE country. It is fitted to the official ديوان الوقف السني printed
 * calendar and reproduces that authority's per-governorate table to ≤2 min when
 * evaluated at each governorate's own coordinates (verified in
 * iraq-governorates.test.ts). See DECISIONS.md ADR-002 (reversed: no longer
 * Baghdad-only). Other countries map via the table; the rest default to MWL.
 */
export function detectMethod(country: string | undefined, _lat: number, _lon: number): DetectedMethod {
  const cc = (country ?? "").toUpperCase();

  if (cc === "IQ") {
    return {
      key: "BaghdadYMA",
      label: METHODS.BaghdadYMA.name,
      asr: "Standard",
      baghdadCalibrated: true,
    };
  }

  const key = COUNTRY_METHOD[cc] ?? "MWL";
  return {
    key,
    label: METHODS[key].name,
    asr: METHODS[key].asr ?? "Standard",
    baghdadCalibrated: false,
  };
}

/** Human label + default Asr for an explicitly-chosen method key. */
export function describeMethod(key: MethodName): { label: string; asr: AsrMadhab } {
  const m = METHODS[key];
  return { label: m.name, asr: m.asr ?? "Standard" };
}
