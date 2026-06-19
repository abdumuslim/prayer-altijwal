import { METHODS, type MethodName } from "../prayer-engine/index.js";
import type { AsrMadhab } from "../prayer-engine/index.js";
import { haversineKm } from "../util/geo-distance.js";

// Country (ISO-3166 alpha-2) → calculation method. See DECISIONS.md ADR-002.
// Iraq (IQ) is handled specially by the Baghdad-radius rule below.
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

// Baghdad city centre (matches the home project's canonical pin).
const BAGHDAD = { lat: 33.321502, lon: 44.358335 };
// Covers greater Baghdad without reaching other governorate capitals
// (Baqubah ≈50 km, Karbala ≈80 km, Hilla ≈90 km).
const BAGHDAD_RADIUS_KM = 40;

export interface DetectedMethod {
  key: MethodName;
  label: string;
  asr: AsrMadhab;
  /** True only inside Baghdad's radius — i.e. the +5/+3/+2 offsets apply. */
  baghdadCalibrated: boolean;
}

/**
 * Resolve the default calculation method for a location.
 *
 * ⚠️ BaghdadYMA offsets are Baghdad-ONLY (hard rule 5): inside the radius we use
 * the full calibrated BaghdadYMA profile; elsewhere in Iraq we use MWL angles
 * (18°/17°, Standard Asr) WITHOUT the offsets — the engine then applies the
 * city's own elevation. Other countries map via the table; the rest default MWL.
 */
export function detectMethod(country: string | undefined, lat: number, lon: number): DetectedMethod {
  const cc = (country ?? "").toUpperCase();

  if (cc === "IQ") {
    if (haversineKm(lat, lon, BAGHDAD.lat, BAGHDAD.lon) <= BAGHDAD_RADIUS_KM) {
      return {
        key: "BaghdadYMA",
        label: METHODS.BaghdadYMA.name,
        asr: "Standard",
        baghdadCalibrated: true,
      };
    }
    return { key: "MWL", label: METHODS.MWL.name, asr: "Standard", baghdadCalibrated: false };
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
