// Browser binding of the pure Iraqi Waqf calibration core
// (docs/NATIVE_ALARM_SPEC.md §3b). The Vite reused-engine resolver redirects the
// reused wrappers' `./iraq-calibration.js` import here in the client build,
// replacing the server loader (which reads the JSON from disk via node:fs). Same
// public signatures; the generated tables come from ESM JSON imports instead.

import calibrationJson from "../../../server/data/iraq-waqf-calibration.json";
import exactJson from "../../../server/data/waqf-exact.json";
import {
  baghdadInstant,
  iraqCalibrationFrom,
  iraqExactTimesFrom,
  mapRawGovs,
  type ExactTable,
  type GovCalibration,
  type IraqCalibration,
  type NoRecycleTable,
  type RawCalibration,
} from "../../../server/src/prayer/iraq-calibration-core.js";
import type { TimeName } from "../../../server/src/prayer-engine/index.js";

const GOVS: readonly GovCalibration[] = mapRawGovs(calibrationJson as unknown as RawCalibration);
const EXACT_JSON = exactJson as unknown as { govs: ExactTable; noRecycle?: NoRecycleTable };
const EXACT: ExactTable = EXACT_JSON.govs;
const NO_RECYCLE: NoRecycleTable = EXACT_JSON.noRecycle ?? {};

export function iraqCalibration(lat: number, lon: number): IraqCalibration | null {
  return iraqCalibrationFrom(GOVS, lat, lon);
}

export function iraqExactTimes(
  lat: number,
  lon: number,
  isoDate: string,
): Partial<Record<TimeName, string>> | null {
  return iraqExactTimesFrom(GOVS, EXACT, lat, lon, isoDate, NO_RECYCLE);
}

export { baghdadInstant };
export type { IraqCalibration };
