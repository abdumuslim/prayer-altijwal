import { describe, expect, test } from "vitest";
import { shortestDelta, smoothingFactor, stepAngle } from "./heading-anim";

describe("shortestDelta", () => {
  test("takes the short way across the 0/360 seam", () => {
    expect(shortestDelta(359, 1)).toBeCloseTo(2, 6);
    expect(shortestDelta(1, 359)).toBeCloseTo(-2, 6);
  });

  test("is signed and within [-180, 180)", () => {
    expect(shortestDelta(0, 90)).toBeCloseTo(90, 6);
    expect(shortestDelta(90, 0)).toBeCloseTo(-90, 6);
    expect(shortestDelta(0, 180)).toBeCloseTo(-180, 6); // antipode: either way is equal
    expect(shortestDelta(0, 181)).toBeCloseTo(-179, 6);
  });

  test("works from a continuous (unbounded) displayed angle", () => {
    // Regression: JS `%` keeps the dividend's sign, so a naive
    // ((to-from+540)%360)-180 returned -350° here and spun the dial the long way
    // once the continuous angle had drifted past a full turn.
    expect(shortestDelta(720 + 10, 20)).toBeCloseTo(10, 6);
    expect(shortestDelta(-350, 20)).toBeCloseTo(10, 6);
    expect(shortestDelta(-1000, 20)).toBeCloseTo(-60, 6);
  });
});

describe("smoothingFactor", () => {
  test("covers more of the gap the longer the frame took", () => {
    const short = smoothingFactor(16, 80);
    const long = smoothingFactor(50, 80);
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(0);
    expect(long).toBeLessThan(1);
  });

  test("one time constant covers ~63% of the gap", () => {
    expect(smoothingFactor(80, 80)).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  test("caps a long stall so a backgrounded tab does not snap on resume", () => {
    expect(smoothingFactor(10_000, 80)).toBe(smoothingFactor(250, 80));
  });

  test("degenerate tau jumps straight to the target", () => {
    expect(smoothingFactor(16, 0)).toBe(1);
  });
});

describe("stepAngle", () => {
  test("moves a fraction of the way toward the target", () => {
    expect(stepAngle(0, 100, 0.25)).toBeCloseTo(25, 6);
  });

  test("converges without overshooting", () => {
    let a = 0;
    for (let i = 0; i < 200; i++) a = stepAngle(a, 90, 0.2);
    expect(a).toBeCloseTo(90, 3);
  });

  test("crosses the seam the short way and stays continuous", () => {
    // Displayed just under 360, target just past 0 → must go UP past 360,
    // never unwind 358° backwards.
    const next = stepAngle(359, 1, 0.5);
    expect(next).toBeGreaterThan(359);
    expect(next).toBeCloseTo(360, 6);
  });

  test("snaps once inside the settle window", () => {
    expect(stepAngle(90, 90.01, 0.1)).toBeCloseTo(90.01, 6);
  });

  test("a full turn of targets keeps the displayed angle monotonic", () => {
    let a = 0;
    const seen: number[] = [];
    for (let deg = 0; deg < 720; deg += 5) {
      for (let i = 0; i < 10; i++) a = stepAngle(a, deg % 360, 0.4);
      seen.push(a);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]); // never spins backwards
    }
  });
});
