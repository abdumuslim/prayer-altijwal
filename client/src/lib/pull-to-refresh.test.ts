import { describe, expect, test } from "vitest";
import {
  canStartPull,
  IDLE_PULL,
  nextPullState,
  PULL_MAX_PX,
  PULL_THRESHOLD_PX,
  resist,
  shouldRefresh,
  type PullState,
} from "./pull-to-refresh";

/** Replay a finger path and return the final state. */
function drag(points: Array<[number, number]>): PullState {
  return points.reduce<PullState>(
    (state, [dx, dy]) => nextPullState(state, dx, dy),
    IDLE_PULL,
  );
}

describe("canStartPull", () => {
  test("only at the very top of the scroller", () => {
    expect(canStartPull(0)).toBe(true);
    expect(canStartPull(-3)).toBe(true); // iOS rubber-band overscroll
    expect(canStartPull(1)).toBe(false);
    expect(canStartPull(400)).toBe(false);
  });
});

describe("nextPullState", () => {
  test("stays neutral until the axis is clear", () => {
    expect(drag([[1, 2], [3, 4]])).toEqual(IDLE_PULL);
  });

  test("a downward drag pulls", () => {
    const state = drag([[0, 6], [0, 40]]);
    expect(state.phase).toBe("pulling");
    expect(state.offset).toBeGreaterThan(0);
  });

  test("a horizontal drag is rejected — the tab pager owns it", () => {
    expect(drag([[30, 4]]).phase).toBe("rejected");
  });

  test("an upward drag is rejected — that is a scroll", () => {
    expect(drag([[0, -30]]).phase).toBe("rejected");
  });

  test("rejection is sticky: a swipe that curves down does not become a pull", () => {
    const state = drag([[40, 2], [40, 80], [10, 120]]);
    expect(state.phase).toBe("rejected");
    expect(state.offset).toBe(0);
  });

  test("a diagonal favouring horizontal is rejected", () => {
    expect(drag([[30, 20]]).phase).toBe("rejected");
  });
});

describe("resist", () => {
  test("the indicator lags the finger", () => {
    expect(resist(40)).toBeLessThan(40);
  });

  test("is monotonic and capped", () => {
    expect(resist(200)).toBeGreaterThan(resist(150));
    expect(resist(10_000)).toBeLessThanOrEqual(PULL_MAX_PX);
  });

  test("crawls past the commit point so the threshold stays legible", () => {
    const perThresholdPx = resist(PULL_THRESHOLD_PX * 2 + 20) - resist(PULL_THRESHOLD_PX * 2);
    expect(perThresholdPx).toBeLessThan(20 * 0.5);
  });
});

describe("shouldRefresh", () => {
  test("commits only past the threshold", () => {
    expect(shouldRefresh({ phase: "pulling", offset: PULL_THRESHOLD_PX })).toBe(true);
    expect(shouldRefresh({ phase: "pulling", offset: PULL_THRESHOLD_PX - 1 })).toBe(false);
  });

  test("a rejected gesture never refreshes, however far it travelled", () => {
    expect(shouldRefresh({ phase: "rejected", offset: 999 })).toBe(false);
    expect(shouldRefresh(IDLE_PULL)).toBe(false);
  });

  test("a real pull-down past the threshold commits end to end", () => {
    expect(shouldRefresh(drag([[0, 10], [0, 90], [0, 200]]))).toBe(true);
  });
});
