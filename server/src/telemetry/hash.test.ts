import { describe, expect, it } from "vitest";
import { HASH_LENGTH, dauHash, quantize } from "./hash.js";

const SALT = "test-telemetry-salt-value";

describe("dauHash", () => {
  it("is stable for the same install on the same day", () => {
    expect(dauHash(SALT, "2026-07-26", "client-a")).toBe(dauHash(SALT, "2026-07-26", "client-a"));
  });

  it("distinguishes two installs on the same day", () => {
    expect(dauHash(SALT, "2026-07-26", "client-a")).not.toBe(
      dauHash(SALT, "2026-07-26", "client-b"),
    );
  });

  it("ROTATES: the same install hashes differently tomorrow", () => {
    // This is the whole privacy property (ADR-016). The day is inside the HMAC
    // message, so stored rows cannot be linked across days — which is also why
    // cross-day uniques (WAU/MAU) are uncomputable and must never be reported.
    const monday = dauHash(SALT, "2026-07-26", "client-a");
    const tuesday = dauHash(SALT, "2026-07-27", "client-a");
    expect(monday).not.toBe(tuesday);
  });

  it("changes completely when the salt is rotated", () => {
    expect(dauHash("another-salt-entirely", "2026-07-26", "client-a")).not.toBe(
      dauHash(SALT, "2026-07-26", "client-a"),
    );
  });

  it("cannot be confused by a client id containing the separator", () => {
    // "a|2026-07-26" must not collide with day="a", client="2026-07-26".
    expect(dauHash(SALT, "2026-07-26", "a|b")).not.toBe(dauHash(SALT, "2026-07-26|a", "b"));
  });

  it("produces a short, url-safe, fixed-length key", () => {
    const h = dauHash(SALT, "2026-07-26", "client-a");
    expect(h).toHaveLength(HASH_LENGTH);
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never contains the raw client id", () => {
    expect(dauHash(SALT, "2026-07-26", "recognisable-client")).not.toContain("recognisable");
  });
});

describe("quantize", () => {
  it("snaps to the ~1.1 km grid", () => {
    expect(quantize(33.315274, 0.01)).toBe(33.32);
    expect(quantize(44.366108, 0.01)).toBe(44.37);
  });

  it("keeps points inside one cell identical", () => {
    expect(quantize(33.3151, 0.01)).toBe(quantize(33.3199, 0.01));
  });

  it("treats negative coordinates as the mirror of positive ones", () => {
    // Uses Math.round, matching places/cache.ts gridKey — one grid convention
    // in the codebase, not two. (33.315 is not exactly representable and lands
    // just under .5, so both signs snap to .31; the point here is the mirror.)
    for (const v of [33.315, 12.344, 0.006, 89.999]) {
      expect(quantize(-v, 0.01)).toBeCloseTo(-quantize(v, 0.01), 10);
    }
    expect(quantize(0, 0.01)).toBe(0);
  });

  it("never emits floating-point noise", () => {
    // 0.1 + 0.2 territory: a raw multiply gives 33.32000000000001.
    for (let i = 0; i < 200; i++) {
      const q = quantize(30 + i * 0.017, 0.01);
      expect(String(q)).toMatch(/^-?\d+(\.\d{1,2})?$/);
    }
  });

  it("passes a coarser grid straight through", () => {
    expect(quantize(33.315, 1)).toBe(33);
    expect(quantize(33.815, 1)).toBe(34);
  });
});
