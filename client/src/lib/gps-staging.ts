// Pure staged-GPS orchestration for the nearest-masjid fix (used by
// hooks/useLocation.ts requestGpsStaged).
//
// Kept out of the hook so the ORDER of the attempts — and, the bug this fixes,
// WHICH attempt is allowed to surface an error — are unit-testable. The masjid
// list is gated on a real GPS fix (docs/QIBLA_MASJID_SPEC.md Q5). On a budget
// phone indoors a cold GNSS lock used to time out BOTH stages on first use, so
// the section showed an error instead of the list, and — even when the coarse
// stage succeeded — a slow precise refine flashed a false location error over a
// list that was already correct.
//
// The stages below paint from the LAST KNOWN position first (instant whenever any
// recent fix exists), fall back patiently on a genuinely cold device, and run the
// precise refine SILENTLY once any fix has landed.

/**
 * A single position request. Resolves to TRUE when a usable GPS fix was obtained,
 * FALSE when the stage failed. `silent` marks a refine attempt whose failure must
 * NOT surface a UI error.
 *
 * It resolves either way — never rejects: the real adapter (useLocation.requestGps)
 * reports failures through UI state, so the staging keys off this boolean rather
 * than exceptions. (Relying on rejection here was a bug — requestGps swallows its
 * errors, so a try/catch treated every stage as a success and the fallback below
 * became dead code.)
 */
export type RequestFix = (
  options: PositionOptions,
  opts?: { silent?: boolean },
) => Promise<boolean>;

/** Stage option sets — one place for the timeouts/ages so the test and the hook
 *  can't drift apart. */
export const GPS_STAGES: Record<"fastCoarse" | "patientCoarse" | "refine", PositionOptions> = {
  /** Instant paint: accept any fix from the last hour (usually the last known
   *  position, returned immediately) before waiting on a fresh coarse fix. */
  fastCoarse: { enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 10_000 },
  /** Cold device, nothing cached: one patient coarse attempt — a network/cell
   *  fix succeeds where a cold GNSS lock times out. */
  patientCoarse: { enableHighAccuracy: false, maximumAge: 60 * 60_000, timeout: 20_000 },
  /** Background refine to a precise fix; silent once we already have one. */
  refine: { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
};

/**
 * Run the staged fix. Resolves once any stage produced a usable fix; throws
 * ("gps unavailable") only when every stage failed — the caller then leaves the
 * error that `requestFix` already surfaced on screen.
 */
export async function runStagedFix(requestFix: RequestFix): Promise<void> {
  // Stage 1 — paint from the last known position (instant whenever any recent fix
  // exists); only a truly cold device waits here for a fresh coarse fix.
  let haveFix = await requestFix(GPS_STAGES.fastCoarse);

  // Stage 1b — cold device, nothing cached: one patient coarse attempt, since a
  // network/cell fix succeeds where a cold GNSS lock times out.
  if (!haveFix) haveFix = await requestFix(GPS_STAGES.patientCoarse);

  // Stage 2 — refine to a precise fix in the background. SILENT once a coarse fix
  // already landed, so a slow/failed precise lock never flashes an error over a
  // list that is already correct; otherwise this is the real attempt and its
  // failure SHOULD reach the user.
  const refined = await requestFix(GPS_STAGES.refine, { silent: haveFix });

  if (!haveFix && !refined) throw new Error("gps unavailable");
}
