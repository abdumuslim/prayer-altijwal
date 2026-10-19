import { describe, expect, it } from "vitest";
import { headingFromEuler } from "./compass-heading";

/** Smallest absolute angular difference in degrees. */
function angDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** Heading that must be defined (non-null) for the pose. */
function heading(alpha: number, beta: number, gamma: number, screen = 0): number {
  const h = headingFromEuler(alpha, beta, gamma, screen);
  expect(h).not.toBeNull();
  return h as number;
}

type Mat = number[][];

function mul(a: Mat, b: Mat): Mat {
  return a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
}

/**
 * Independent reference: build R = Rz(alpha)·Rx(beta)·Ry(gamma) by matrix product
 * (W3C intrinsic Z-X'-Y''), rotate the screen-up axis into the earth frame
 * (x east, y north, z up) and take its horizontal compass bearing.
 */
function reference(alpha: number, beta: number, gamma: number, screen: number): {
  deg: number;
  horiz: number;
} {
  const r = Math.PI / 180;
  const [a, b, g, t] = [alpha * r, beta * r, gamma * r, screen * r];
  const rz = [
    [Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0],
    [0, 0, 1],
  ];
  const rx = [
    [1, 0, 0],
    [0, Math.cos(b), -Math.sin(b)],
    [0, Math.sin(b), Math.cos(b)],
  ];
  const ry = [
    [Math.cos(g), 0, Math.sin(g)],
    [0, 1, 0],
    [-Math.sin(g), 0, Math.cos(g)],
  ];
  const m = mul(mul(rz, rx), ry);
  // Screen-up in the device frame: +Y in portrait, +X at 90°, −Y at 180°, −X at 270°.
  const u = [Math.sin(t), Math.cos(t), 0];
  const w = m.map((row) => row[0] * u[0] + row[1] * u[1] + row[2] * u[2]);
  return {
    deg: (((Math.atan2(w[0], w[1]) * 180) / Math.PI) % 360 + 360) % 360,
    horiz: Math.hypot(w[0], w[1]),
  };
}

// W3C deviceorientation: alpha about Z (counter-clockwise seen from above),
// beta = top edge raised (+) / lowered (−), gamma = roll.
describe("headingFromEuler", () => {
  it("phone flat, top to the north: small tilts in any direction keep the heading at 0", () => {
    for (const [beta, gamma] of [
      [0, 0],
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3],
      [2, 2],
      [10, 5],
      [20, 10],
      [-15, -20],
    ]) {
      expect(angDiff(heading(0, beta, gamma), 0)).toBeLessThan(0.5);
    }
  });

  it("phone flat: alpha maps to the top edge's compass direction (east, south, west)", () => {
    expect(angDiff(heading(270, 5, 0), 90)).toBeLessThan(0.5);
    expect(angDiff(heading(270, 0, 5), 90)).toBeLessThan(0.5);
    expect(angDiff(heading(180, -4, 6), 180)).toBeLessThan(0.5);
    expect(angDiff(heading(90, 1, -7), 270)).toBeLessThan(0.5);
  });

  it("roll (gamma) never moves the portrait heading", () => {
    for (let gamma = -60; gamma <= 60; gamma += 15) {
      expect(angDiff(heading(300, 25, gamma), 60)).toBeLessThan(0.5);
    }
  });

  it("matches the independent matrix projection at every screen rotation", () => {
    let checked = 0;
    for (const screen of [0, 90, 180, 270]) {
      for (let alpha = 0; alpha < 360; alpha += 41) {
        for (let beta = -175; beta <= 175; beta += 19) {
          for (let gamma = -85; gamma <= 85; gamma += 17) {
            const ref = reference(alpha, beta, gamma, screen);
            const got = headingFromEuler(alpha, beta, gamma, screen);
            if (ref.horiz < 0.3) continue; // near-vertical screen-up: covered below
            expect(got).not.toBeNull();
            expect(angDiff(got as number, ref.deg)).toBeLessThan(1e-6);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000); // non-vacuity
  });

  it("tilted landscape uses the projected screen-top, not the portrait heading + 90", () => {
    // Sol review 2026-10-19: (0, 25, 25) at 90° is 78.85°, not 90°.
    expect(angDiff(heading(0, 25, 25, 90), 78.85)).toBeLessThan(0.05);
  });

  it("upside-down and screen-down poses report where the screen's top really points", () => {
    expect(angDiff(heading(0, 179, 0), 180)).toBeLessThan(0.5);
    expect(angDiff(heading(0, -120, 0), 180)).toBeLessThan(0.5);
    expect(angDiff(heading(0, -60, 0), 0)).toBeLessThan(0.5);
  });

  it("returns null (no defined heading) when the screen's top points nearly straight up or down", () => {
    expect(headingFromEuler(0, 90, 0, 0)).toBeNull();
    expect(headingFromEuler(123, 80, 40, 0)).toBeNull();
    expect(headingFromEuler(10, -88, 0, 0)).toBeNull();
    expect(headingFromEuler(10, 0, 89, 90)).toBeNull();
    expect(headingFromEuler(10, 0, -85, 270)).toBeNull();
  });

  it("never jumps: neighbouring poses 0.5° apart give neighbouring headings", () => {
    let pairs = 0;
    for (const screen of [0, 90]) {
      for (const alpha of [0, 140, 275]) {
        for (let gamma = -80; gamma <= 80; gamma += 20) {
          let prev: number | null = null;
          for (let beta = -180; beta <= 180; beta += 0.5) {
            const h = headingFromEuler(alpha, beta, gamma, screen);
            if (h != null && prev != null) {
              // 0.5° of rotation moves a projection whose horizontal length is
              // ≥ 0.25 by at most ~2°; a fallback switch would jump far more.
              expect(angDiff(h, prev)).toBeLessThan(3);
              pairs++;
            }
            prev = h;
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(20_000); // non-vacuity
  });

  it("always returns null or a finite angle in [0, 360)", () => {
    for (const screen of [0, 90, 180, 270]) {
      for (let alpha = 0; alpha < 360; alpha += 37) {
        for (let beta = -180; beta < 180; beta += 23) {
          for (let gamma = -90; gamma < 90; gamma += 29) {
            const h = headingFromEuler(alpha, beta, gamma, screen);
            if (h == null) continue;
            expect(Number.isFinite(h)).toBe(true);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThan(360);
          }
        }
      }
    }
  });
});
