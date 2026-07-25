/**
 * Free travel-time estimate from straight-line distance.
 *
 * Why this exists: the Routes API bills PER ELEMENT, and pricing the whole
 * visible list on every cache miss (5 rows × WALK + DRIVE = 10 elements) was the
 * single constraint capping the app at ~1 000 lookups/month — five times sooner
 * than the Places search itself. The list now shows this estimate, and a REAL
 * Routes lookup is spent only when the user expands a row (docs/DECISIONS.md
 * ADR-014).
 *
 * Accuracy is deliberately modest: a masjid 400 m away is "a few minutes' walk"
 * however you measure it, and the row that matters gets the real number on tap.
 */

/** Average walking pace, km/h. */
export const WALK_KMH = 5;
/** Average in-city driving pace, km/h (junctions and lights, not open road). */
export const DRIVE_KMH = 30;
/** Street distance ÷ straight-line distance for a typical urban grid. */
export const DETOUR_FACTOR = 1.3;

/** Estimated travel time to a point, in whole minutes. Never zero. */
export interface TravelEstimate {
  walkMin: number;
  driveMin: number;
}

function minutesAt(distanceKm: number, kmh: number): number {
  // "0 min away" reads as broken, so one minute is the floor — same rule the
  // real Routes mapper applies in google-routes.ts.
  return Math.max(1, Math.round((distanceKm / kmh) * 60));
}

/**
 * Estimate walking and driving minutes for a straight-line distance in km.
 * Defensive by contract: garbage in (NaN, Infinity, negative) yields the
 * one-minute floor rather than a NaN that would render as "NaN د مشياً".
 */
export function estimateTravel(distanceKm: number): TravelEstimate {
  const km =
    Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm * DETOUR_FACTOR : 0;
  return {
    walkMin: minutesAt(km, WALK_KMH),
    driveMin: minutesAt(km, DRIVE_KMH),
  };
}
