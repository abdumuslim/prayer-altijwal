import { describe, it, expect } from "vitest";
import { createSlidingLimiter } from "./rate-limit.js";

describe("createSlidingLimiter", () => {
  it("allows up to perKey hits per key within a window", () => {
    let t = 0;
    const limiter = createSlidingLimiter({ windowMs: 1000, perKey: 3, now: () => t });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("keeps keys independent", () => {
    let t = 0;
    const limiter = createSlidingLimiter({ windowMs: 1000, perKey: 1, now: () => t });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("resets a key's count once its window rolls", () => {
    let t = 0;
    const limiter = createSlidingLimiter({ windowMs: 1000, perKey: 1, now: () => t });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    t = 1001;
    expect(limiter.allow("a")).toBe(true);
  });

  it("enforces a global ceiling across all keys, and warns once", () => {
    let t = 0;
    let trips = 0;
    const limiter = createSlidingLimiter({
      windowMs: 1000,
      perKey: 100,
      globalPerWindow: 2,
      now: () => t,
      onGlobalTrip: () => trips++,
    });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("c")).toBe(false); // over the global cap
    expect(limiter.allow("d")).toBe(false);
    expect(trips).toBe(1); // once per window, not once per request
  });

  it("evicts the least-recently-used key past maxKeys", () => {
    let t = 0;
    const limiter = createSlidingLimiter({ windowMs: 10_000, perKey: 1, maxKeys: 2, now: () => t });
    limiter.allow("a");
    limiter.allow("b");
    limiter.allow("c"); // evicts "a" (the LRU key; nothing has refreshed it)
    expect(limiter.size()).toBe(2);
    // "a" was forgotten, so it starts a fresh window and is allowed again.
    expect(limiter.allow("a")).toBe(true);
  });

  // A true sliding window: a fixed window would reset at the boundary and let a
  // caller fire perKey again immediately, ~2× the rate across the seam. Here the
  // earlier hits keep counting until they actually age out of the trailing window.
  it("rejects a burst that straddles the window boundary", () => {
    let t = 900;
    const limiter = createSlidingLimiter({ windowMs: 1000, perKey: 2, now: () => t });
    expect(limiter.allow("a")).toBe(true); // hit @900
    expect(limiter.allow("a")).toBe(true); // hit @900, now at the cap
    expect(limiter.allow("a")).toBe(false);

    // 400ms past the fixed-window boundary (t>1000): a naive limiter would have
    // reset and allowed two more. The two 900ms hits are still inside the
    // trailing 1000ms, so the sliding window keeps rejecting.
    t = 1300;
    expect(limiter.allow("a")).toBe(false);

    // Only once both 900ms hits age out (t - windowMs > 900) does capacity return.
    t = 1901;
    expect(limiter.allow("a")).toBe(true);
  });

  // LRU, not FIFO: a key that keeps being accessed must not be evicted (and so
  // reset) while an idle key is still tracked.
  it("retains an active key under eviction pressure, dropping the idle one", () => {
    let t = 0;
    const limiter = createSlidingLimiter({ windowMs: 10_000, perKey: 1, maxKeys: 2, now: () => t });
    expect(limiter.allow("hot")).toBe(true); // hot at its cap
    expect(limiter.allow("idle")).toBe(true);
    expect(limiter.allow("hot")).toBe(false); // still capped, and refreshes hot's recency

    // Inserting a third key evicts the LRU one, which is now "idle", NOT "hot".
    expect(limiter.allow("new")).toBe(true);
    expect(limiter.size()).toBe(2);

    // "hot" kept its state, so it stays rejected. A FIFO cap would have evicted
    // "hot" on the previous insert and wrongly allowed it here.
    expect(limiter.allow("hot")).toBe(false);
    // "idle" was the one dropped, so it starts fresh and is allowed again.
    expect(limiter.allow("idle")).toBe(true);
  });
});
