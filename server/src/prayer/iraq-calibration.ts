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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { haversineKm } from "../util/geo-distance.js";
import { childLogger } from "../logger.js";
import type { RoundingRule, TimeName } from "../prayer-engine/index.js";

const log = childLogger("prayer/iraq-calibration");

const PRAYERS: TimeName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

/**
 * Beyond this distance from a governorate capital we do NOT serve that capital's
 * exact poster numbers — the per-gov-calibrated formula (computed at the user's
 * own coordinates) is the better answer for points between capitals.
 */
const EXACT_OVERRIDE_KM = 45;

interface GovCalibration {
  name: string;
  lat: number;
  lon: number;
  offsets: Partial<Record<TimeName, number>>;
  rounding: Partial<Record<TimeName, RoundingRule>>;
}

function dataPath(file: string): string {
  // Works in dev (src/prayer) and compiled (dist/prayer): Docker copies data to /app/data.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../data", file);
}

function loadGovs(): GovCalibration[] {
  const raw = JSON.parse(readFileSync(dataPath("iraq-waqf-calibration.json"), "utf8")) as {
    govs: Array<{
      name: string;
      lat: number;
      lon: number;
      offsets: Record<string, number>;
      rules: Record<string, RoundingRule>;
    }>;
  };
  return raw.govs.map((g) => ({ name: g.name, lat: g.lat, lon: g.lon, offsets: g.offsets, rounding: g.rules }));
}

type ExactTable = Record<string, Record<string, Record<string, string>>>;
function loadExact(): ExactTable {
  const raw = JSON.parse(readFileSync(dataPath("waqf-exact.json"), "utf8")) as { govs: ExactTable };
  return raw.govs;
}

const GOVS: readonly GovCalibration[] = loadGovs();
const EXACT: ExactTable = loadExact();
log.info("loaded Iraqi Waqf calibration", { govs: GOVS.length, exactGovs: Object.keys(EXACT).length });

function nearestGov(lat: number, lon: number): { gov: GovCalibration; km: number } | null {
  let best: GovCalibration | null = null;
  let bestKm = Infinity;
  for (const g of GOVS) {
    const km = haversineKm(lat, lon, g.lat, g.lon);
    if (km < bestKm) {
      bestKm = km;
      best = g;
    }
  }
  return best ? { gov: best, km: bestKm } : null;
}

export interface IraqCalibration {
  /** Nearest calibrated governorate. */
  gov: string;
  /** Distance to that governorate's capital (km). */
  km: number;
  /** Per-prayer minute offsets (override the method's flat defaults). */
  adjustments: Partial<Record<TimeName, number>>;
  /** Per-prayer rounding rule. */
  rounding: Partial<Record<TimeName, RoundingRule>>;
}

/**
 * Per-(gov,prayer) calibrated offsets + rounding for the nearest Iraqi
 * governorate — for the nationwide BaghdadYMA profile only. Returns null only if
 * the calibration table is empty.
 */
export function iraqCalibration(lat: number, lon: number): IraqCalibration | null {
  const near = nearestGov(lat, lon);
  if (!near) return null;
  return { gov: near.gov.name, km: near.km, adjustments: near.gov.offsets, rounding: near.gov.rounding };
}

/**
 * Official poster times (HH:MM, 24-hour Asia/Baghdad) for a LITERAL 0-min match,
 * when the location is at/near a governorate capital and that (gov, date) has
 * been digitized. Returns null otherwise (→ caller uses the calibrated formula).
 */
export function iraqExactTimes(
  lat: number,
  lon: number,
  isoDate: string,
): Partial<Record<TimeName, string>> | null {
  const near = nearestGov(lat, lon);
  if (!near || near.km > EXACT_OVERRIDE_KM) return null;
  const cell = EXACT[near.gov.name]?.[isoDate];
  if (!cell) return null;
  const out: Partial<Record<TimeName, string>> = {};
  for (const p of PRAYERS) if (cell[p]) out[p] = cell[p];
  return Object.keys(out).length ? out : null;
}

/**
 * Build a UTC instant from a Baghdad civil date + HH:MM. Asia/Baghdad is a fixed
 * UTC+3 (no DST since 2008), so the +03:00 offset is exact (hard rule 7: never
 * use server-local wall-clock — the offset is explicit here).
 */
export function baghdadInstant(isoDate: string, hhmm: string): Date {
  return new Date(`${isoDate}T${hhmm}:00+03:00`);
}
