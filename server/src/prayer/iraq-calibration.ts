// Nationwide Iraqi (BaghdadYMA) calibration, fit to the official ديوان الوقف
// السني per-governorate table.
//
// Two layers, both keyed on the nearest of the 15 calibrated governorates:
//   1. iraqCalibration() — a per-(gov,prayer) minute offset + rounding rule,
//      passed to the engine as `config.adjustments` / `config.rounding`. This
//      REPLACES the method's flat +5/+3/+2 with per-gov constants (validated:
//      ~83% exact-to-the-minute, 99.4% within ±1 over 35 official dates × 15
//      govs — see scripts/build-waqf-calibration.ts). Seasonal structure is
//      negligible (<1 min across the full declination span), so a constant per
//      gov is the calibrated-not-overfit model.
//   2. iraqExactTimes() — for a location AT a governorate capital on a date we
//      have digitized, the official poster numbers verbatim (literal 0-min
//      match). Falls back to the formula everywhere else.
//
// Data is generated (never hand-edited) by scripts/build-waqf-calibration.ts.
//
// This file is the SERVER loader: it reads the generated JSON from disk and binds
// the pure, browser-safe logic in iraq-calibration-core.ts (which the native
// Capacitor app reuses via client/src/native/iraq-calibration-browser.ts). Public
// signatures are unchanged so compute.ts / payload.ts / tests are untouched.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { childLogger } from "../logger.js";
import {
  baghdadInstant,
  iraqCalibrationFrom,
  iraqExactTimesFrom,
  mapRawGovs,
  type ExactTable,
  type GovCalibration,
  type IraqCalibration,
  type RawCalibration,
} from "./iraq-calibration-core.js";
import type { TimeName } from "../prayer-engine/index.js";

const log = childLogger("prayer/iraq-calibration");

function dataPath(file: string): string {
  // Works in dev (src/prayer) and compiled (dist/prayer): Docker copies data to /app/data.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data", file);
}

const GOVS: readonly GovCalibration[] = mapRawGovs(
  JSON.parse(readFileSync(dataPath("iraq-waqf-calibration.json"), "utf8")) as RawCalibration,
);
const EXACT: ExactTable = (
  JSON.parse(readFileSync(dataPath("waqf-exact.json"), "utf8")) as { govs: ExactTable }
).govs;
log.info("loaded Iraqi Waqf calibration", { govs: GOVS.length, exactGovs: Object.keys(EXACT).length });

/** Per-(gov,prayer) calibrated offsets + rounding for the nearest Iraqi governorate. */
export function iraqCalibration(lat: number, lon: number): IraqCalibration | null {
  return iraqCalibrationFrom(GOVS, lat, lon);
}

/** Official poster times (HH:MM) for a literal 0-min match, or null. */
export function iraqExactTimes(
  lat: number,
  lon: number,
  isoDate: string,
): Partial<Record<TimeName, string>> | null {
  return iraqExactTimesFrom(GOVS, EXACT, lat, lon, isoDate);
}

export { baghdadInstant };
export type { IraqCalibration };
