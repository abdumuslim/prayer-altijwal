// Pure swipe-gesture math for the tab pager (components/shell/TabPager). Kept in
// lib/ so it is node-testable with no DOM, per the repo's "pure logic in lib/,
// thin component shells" convention.

/** Commit when dragged at least this fraction of the viewport width. */
export const SWIPE_COMMIT_FRACTION = 0.25;
/** …or when flicked at least this fast (px/ms) over SWIPE_MIN_FLICK_PX. */
export const SWIPE_FLICK_VELOCITY = 0.5;
export const SWIPE_MIN_FLICK_PX = 24;
/** Movement (px) before the gesture axis is decided (horizontal vs vertical). */
export const SWIPE_AXIS_LOCK_PX = 12;
/** Rubber-band factor when dragging past the first/last page. */
export const SWIPE_EDGE_RESISTANCE = 0.35;

/**
 * Resolve a finished drag into a logical tab delta (−1 previous, 0 none, +1
 * next). `dir` mirrors the document direction so the same finger motion advances
 * "forward" in the reading direction:
 *   - LTR: drag left → next, drag right → previous.
 *   - RTL: drag right → next, drag left → previous (mirrors the RTL tab bar).
 * A gesture that is more vertical than horizontal never commits (returns 0), and
 * a horizontal drag commits only past the distance OR flick-velocity threshold.
 */
export function resolveSwipe(
  dx: number,
  dy: number,
  dtMs: number,
  width: number,
  dir: "ltr" | "rtl",
): -1 | 0 | 1 {
  if (Math.abs(dx) <= Math.abs(dy)) return 0; // not a horizontal gesture
  const committed =
    Math.abs(dx) >= width * SWIPE_COMMIT_FRACTION ||
    (dtMs > 0 &&
      Math.abs(dx) / dtMs >= SWIPE_FLICK_VELOCITY &&
      Math.abs(dx) >= SWIPE_MIN_FLICK_PX);
  if (!committed) return 0;
  const physDelta = dx > 0 ? -1 : 1; // drag right reveals the physically-left page
  return (dir === "rtl" ? -physDelta : physDelta) as -1 | 0 | 1;
}
