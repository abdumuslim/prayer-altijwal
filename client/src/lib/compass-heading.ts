// Compass heading from W3C deviceorientation Euler angles, for the WEB compass
// paths (hooks/useCompassHeading). The angles are intrinsic Z-X'-Y'' in
// degrees: alpha about Z, then beta (top edge raised +), then gamma (roll), so
// the device-to-earth rotation is R = Rz(alpha)·Rx(beta)·Ry(gamma) with the
// earth frame x = east, y = north, z = up.
//
// The heading is the horizontal direction of the SCREEN's top edge: the
// screen-up axis (device +Y in portrait, +X / −Y / −X at 90 / 180 / 270° of
// screen.orientation.angle) rotated into the earth frame and projected onto the
// ground. In portrait that is the same quantity Android's
// SensorManager.getOrientation azimuth gives the native path, and roll is
// compensated exactly. Projecting the screen-up axis itself (rather than adding
// the screen angle to the portrait heading afterwards) keeps tilted landscape
// exact: the two device axes stop projecting 90° apart once pitch and roll
// combine (Sol review 2026-10-19).
//
// The W3C spec's worked example (used here until 2026-10-19) computes another
// vector, the direction the BACK of the device faces. Lying flat, that vector
// points at the floor, so its heading swung by 90–180° with a few degrees of
// tilt and was NaN when perfectly flat (the "compass not accurate" report).
//
// When the screen's top points nearly straight up or down its ground
// projection is too short to have a trustworthy direction, so there is no
// heading (null) and the caller keeps the last one while the hold-flat hint
// shows. There is deliberately no fallback to another vector: every fallback
// disagrees with the projection at its switch point under roll, which made the
// needle jump (Sol review 2026-10-19).

const RAD = Math.PI / 180;

/** Shortest ground projection (of a unit vector) still trusted: ~75.5° of tilt. */
const MIN_HORIZONTAL = 0.25;

/**
 * Degrees clockwise from MAGNETIC north of the screen's top edge, in [0, 360),
 * or null when the screen's top is within ~15° of vertical.
 */
export function headingFromEuler(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle = 0,
): number | null {
  const sA = Math.sin(alpha * RAD);
  const cA = Math.cos(alpha * RAD);
  const sB = Math.sin(beta * RAD);
  const cB = Math.cos(beta * RAD);
  const sG = Math.sin(gamma * RAD);
  const cG = Math.cos(gamma * RAD);
  const sT = Math.sin(screenAngle * RAD);
  const cT = Math.cos(screenAngle * RAD);

  // Device +X and +Y in the earth frame (first two columns of R), horizontal parts.
  const xEast = cA * cG - sA * sB * sG;
  const xNorth = sA * cG + cA * sB * sG;
  const yEast = -sA * cB;
  const yNorth = cA * cB;

  // Screen-up = sin(t)·X + cos(t)·Y in the device frame.
  const east = sT * xEast + cT * yEast;
  const north = sT * xNorth + cT * yNorth;
  if (Math.hypot(east, north) < MIN_HORIZONTAL) return null;
  return (((Math.atan2(east, north) / RAD) % 360) + 360) % 360;
}
