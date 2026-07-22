import { describe, expect, it } from "vitest";
import { resolveSwipe } from "./swipe";

const W = 360; // representative phone viewport width

describe("resolveSwipe", () => {
  it("ignores vertical-dominant drags (axis reject)", () => {
    expect(resolveSwipe(30, 80, 200, W, "ltr")).toBe(0);
    expect(resolveSwipe(-30, -80, 200, W, "rtl")).toBe(0);
    // exactly diagonal counts as vertical (not a horizontal gesture)
    expect(resolveSwipe(40, 40, 200, W, "ltr")).toBe(0);
  });

  it("does not commit a short, slow horizontal drag", () => {
    // 50px over 1s: below 25% width AND below flick velocity
    expect(resolveSwipe(50, 5, 1000, W, "ltr")).toBe(0);
    expect(resolveSwipe(-50, 5, 1000, W, "rtl")).toBe(0);
  });

  it("commits past the distance threshold (25% width)", () => {
    const far = W * 0.25 + 1; // 91px
    // LTR: drag left → next, drag right → previous
    expect(resolveSwipe(-far, 10, 1000, W, "ltr")).toBe(1);
    expect(resolveSwipe(far, 10, 1000, W, "ltr")).toBe(-1);
    // RTL: mirrored — drag right → next, drag left → previous
    expect(resolveSwipe(far, 10, 1000, W, "rtl")).toBe(1);
    expect(resolveSwipe(-far, 10, 1000, W, "rtl")).toBe(-1);
  });

  it("commits a fast short flick even below the distance threshold", () => {
    // 40px in 50ms = 0.8 px/ms ≥ 0.5, and ≥ 24px min — commits though < 25% width
    expect(resolveSwipe(-40, 5, 50, W, "ltr")).toBe(1);
    expect(resolveSwipe(40, 5, 50, W, "rtl")).toBe(1);
  });

  it("does not flick-commit a tiny movement", () => {
    // 20px in 20ms is fast but under the 24px minimum
    expect(resolveSwipe(-20, 2, 20, W, "ltr")).toBe(0);
  });
});
