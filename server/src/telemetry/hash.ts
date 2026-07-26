import { createHmac } from "node:crypto";

/**
 * The daily-rotating install key (ADR-016).
 *
 * `dauHash` is the reason this whole feature is defensible: the DAY IS PART OF
 * THE HMAC MESSAGE, so the same install produces a different key every day and
 * two stored rows cannot be tied together. The raw client id is never stored.
 *
 * The direct consequence — which every reader of usage_ping must respect — is
 * that cross-day uniques (true WAU/MAU) are UNCOMPUTABLE from this data. Report
 * averages of daily actives instead, and label them as such.
 */

/** 22 base64url characters ≈ 132 bits: collision-free at any plausible scale. */
export const HASH_LENGTH = 22;

export function dauHash(salt: string, day: string, clientId: string): string {
  // Length-prefixing the day removes any ambiguity between the two fields, so
  // a crafted client id cannot impersonate another day's key.
  return createHmac("sha256", salt)
    .update(`${day.length}:${day}|${clientId}`)
    .digest("base64url")
    .slice(0, HASH_LENGTH);
}

/**
 * Snap a coordinate to a grid. The client already does this before sending;
 * the server repeats it so a modified client cannot cause finer data to be
 * stored than the declared precision.
 *
 * The rounding at the end matters: `Math.round(33.3152/0.01)*0.01` is
 * 33.32000000000001 in binary floating point, and that noise would both look
 * wrong and defeat grouping.
 */
export function quantize(value: number, gridDeg: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(gridDeg) || gridDeg <= 0) return value;
  const snapped = Math.round(value / gridDeg) * gridDeg;
  // Decimal places implied by the grid (0.01 → 2), capped for safety.
  const places = Math.min(10, Math.max(0, Math.ceil(-Math.log10(gridDeg))));
  return Number(snapped.toFixed(places));
}
