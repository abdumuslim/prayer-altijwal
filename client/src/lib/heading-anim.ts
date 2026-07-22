// Pure math for animating a compass heading OUTSIDE React (see QiblaCompass).
//
// The sensor stream runs at ~20 Hz. Rendering it through React state re-rendered
// the whole Times tab 20×/s and restarted a 200 ms CSS transition on ~30 nodes
// every 50 ms — the "laggy" report. Instead the components subscribe to the raw
// stream and drive transforms from one rAF loop, using these helpers.

/**
 * Shortest signed difference from→to in degrees, within [−180, 180).
 *
 * `from` is routinely a CONTINUOUS angle that has drifted far outside 0–360, and
 * JS `%` keeps the sign of the dividend — so the modulo must be normalized into
 * the positive range first. Skipping that returns e.g. −350° instead of +10°,
 * i.e. the dial spins nearly all the way round the wrong way.
 */
export function shortestDelta(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/**
 * Frame-rate-independent easing weight: the fraction of the remaining distance
 * to cover in `dtMs`, for an exponential approach with time constant `tauMs`.
 * A dropped frame therefore moves further instead of stalling.
 */
export function smoothingFactor(dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return 1;
  const dt = Math.max(0, Math.min(dtMs, 250)); // cap: a backgrounded tab must not jump
  return 1 - Math.exp(-dt / tauMs);
}

/** Below this the angle snaps — sub-pixel motion no one can see. */
const SETTLE_DEG = 0.05;

/**
 * One animation frame toward `target`, always taking the short way round.
 *
 * `displayed` is CONTINUOUS (unbounded, may drift far outside 0–360): that is
 * what keeps a 359°→1° step from spinning the dial the long way, and it is why
 * callers must feed the previous return value straight back in.
 */
export function stepAngle(displayed: number, target: number, k: number): number {
  const delta = shortestDelta(displayed, target);
  if (Math.abs(delta) <= SETTLE_DEG) return displayed + delta;
  return displayed + delta * k;
}
