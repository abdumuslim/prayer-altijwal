// Pure pull-to-refresh gesture math (see components/ui/PullToRefresh).
//
// Kept out of the component so the arming rules — which is where a pull-down
// wrongly hijacks a scroll or a horizontal tab-swipe — are unit-testable.

/** Pixels of finger travel needed to commit a refresh. */
export const PULL_THRESHOLD_PX = 70;
/** How far the indicator may travel (past the threshold it barely moves). */
export const PULL_MAX_PX = 110;
/** Fraction of finger travel the indicator follows — the rubber-band feel. */
const RESISTANCE = 0.5;
/** Below this the axis is still ambiguous; commit to neither gesture yet. */
const AXIS_LOCK_PX = 8;

export type PullPhase =
  /** Finger down at the top, direction not yet decided. */
  | "armed"
  /** Pulling down — the component shows the indicator and eats the scroll. */
  | "pulling"
  /** The gesture belongs to something else (scroll up, horizontal swipe). */
  | "rejected";

export interface PullState {
  phase: PullPhase;
  /** Indicator offset in px (already resisted and capped). */
  offset: number;
}

/**
 * Can a pull even start here? Only at the very top of the scroller — otherwise
 * the finger is scrolling content, and stealing that is the classic
 * pull-to-refresh bug.
 */
export function canStartPull(scrollTop: number): boolean {
  return scrollTop <= 0;
}

/**
 * Advance the gesture given the total movement since touch-down.
 *
 * Rejection is STICKY: once the finger has gone sideways (a tab swipe) or up
 * (a scroll), that gesture keeps ownership even if it later curves downward.
 */
export function nextPullState(prev: PullState, dx: number, dy: number): PullState {
  if (prev.phase === "rejected") return prev;

  const travel = Math.max(Math.abs(dx), Math.abs(dy));
  if (travel < AXIS_LOCK_PX) return { phase: "armed", offset: 0 };

  // Horizontal intent belongs to the tab pager; upward intent to the scroller.
  if (Math.abs(dx) > Math.abs(dy) || dy <= 0) {
    return { phase: "rejected", offset: 0 };
  }

  return { phase: "pulling", offset: resist(dy) };
}

/** Diminishing-returns mapping from finger travel to indicator offset. */
export function resist(dy: number): number {
  const eased = dy * RESISTANCE;
  if (eased <= PULL_THRESHOLD_PX) return eased;
  // Past the threshold the indicator crawls, so the commit point stays obvious.
  return Math.min(PULL_MAX_PX, PULL_THRESHOLD_PX + (eased - PULL_THRESHOLD_PX) * 0.35);
}

/** Does releasing now trigger a refresh? */
export function shouldRefresh(state: PullState): boolean {
  return state.phase === "pulling" && state.offset >= PULL_THRESHOLD_PX;
}

export const IDLE_PULL: PullState = { phase: "armed", offset: 0 };
