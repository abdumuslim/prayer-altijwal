import { describe, it, expect } from "vitest";
import {
  BASE_LOCK_MS,
  GLOBAL_LOCK_MS,
  GLOBAL_MAX_FAILS,
  MAX_FAILS,
  MAX_KEYS,
  WINDOW_MS,
  createLoginThrottle,
} from "./rate-limit.js";

const T0 = Date.UTC(2026, 6, 26, 12, 0, 0);
const KEY = "203.0.113.0/24";

function failTimes(t: ReturnType<typeof createLoginThrottle>, key: string, n: number, at: number) {
  for (let i = 0; i < n; i++) t.recordFailure(key, at);
}

describe("per-key throttling", () => {
  it("allows attempts before the limit", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, MAX_FAILS - 1, T0);
    expect(t.check(KEY, T0).allowed).toBe(true);
  });

  it("locks the key once the limit is reached", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, MAX_FAILS, T0);
    const decision = t.check(KEY, T0);
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSec).toBeGreaterThan(0);
  });

  it("does not lock a different key", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, MAX_FAILS, T0);
    expect(t.check("198.51.100.0/24", T0).allowed).toBe(true);
  });

  it("releases the lock once it expires", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, MAX_FAILS, T0);
    expect(t.check(KEY, T0 + BASE_LOCK_MS - 1).allowed).toBe(false);
    expect(t.check(KEY, T0 + BASE_LOCK_MS + 1).allowed).toBe(true);
  });

  it("doubles the lock on each repeat, capped", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, MAX_FAILS, T0);
    expect(t.check(KEY, T0 + BASE_LOCK_MS + 1).allowed).toBe(true);

    // Second lockout: twice as long.
    const t1 = T0 + BASE_LOCK_MS + 1;
    failTimes(t, KEY, MAX_FAILS, t1);
    expect(t.check(KEY, t1 + BASE_LOCK_MS + 1).allowed).toBe(false);
    expect(t.check(KEY, t1 + 2 * BASE_LOCK_MS + 1).allowed).toBe(true);
  });

  it("forgets stale failures outside the window", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, MAX_FAILS - 1, T0);
    // Long enough later that the earlier failures no longer count.
    const later = T0 + WINDOW_MS + 1;
    failTimes(t, KEY, MAX_FAILS - 1, later);
    expect(t.check(KEY, later).allowed).toBe(true);
  });

  it("clears the counter on a successful login", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, MAX_FAILS - 1, T0);
    t.recordSuccess(KEY, T0);
    failTimes(t, KEY, MAX_FAILS - 1, T0);
    expect(t.check(KEY, T0).allowed).toBe(true);
  });
});

describe("global backstop", () => {
  // clientIpOf trusts cf-connecting-ip / x-forwarded-for, which anyone hitting
  // the origin directly can rotate at will — so per-key limits alone are not a
  // real bound on guesses.
  it("locks everything once enough failures arrive across many keys", () => {
    const t = createLoginThrottle();
    for (let i = 0; i < GLOBAL_MAX_FAILS; i++) t.recordFailure(`10.0.${i}.0/24`, T0);
    expect(t.check("192.0.2.0/24", T0).allowed).toBe(false);
  });

  it("releases the global lock once it expires", () => {
    const t = createLoginThrottle();
    for (let i = 0; i < GLOBAL_MAX_FAILS; i++) t.recordFailure(`10.0.${i}.0/24`, T0);
    expect(t.check("192.0.2.0/24", T0 + GLOBAL_LOCK_MS + 1).allowed).toBe(true);
  });

  it("lets a previously successful key through the global lock", () => {
    // Otherwise a botnet could lock the operator out of his own dashboard
    // indefinitely just by failing 50 logins every 15 minutes.
    const t = createLoginThrottle();
    t.recordSuccess(KEY, T0);
    for (let i = 0; i < GLOBAL_MAX_FAILS; i++) t.recordFailure(`10.0.${i}.0/24`, T0);
    expect(t.check("192.0.2.0/24", T0).allowed).toBe(false);
    expect(t.check(KEY, T0).allowed).toBe(true);
  });

  it("still enforces a trusted key's own lock", () => {
    const t = createLoginThrottle();
    t.recordSuccess(KEY, T0);
    failTimes(t, KEY, MAX_FAILS, T0);
    expect(t.check(KEY, T0).allowed).toBe(false);
  });
});

describe("memory bounds", () => {
  it("never grows past the key cap", () => {
    const t = createLoginThrottle();
    for (let i = 0; i < MAX_KEYS * 2; i++) t.recordFailure(`10.${i >> 8}.${i & 255}.0/24`, T0 + i);
    expect(t.stats().keys).toBeLessThanOrEqual(MAX_KEYS);
  });

  it("drops entries that have aged out", () => {
    const t = createLoginThrottle();
    failTimes(t, KEY, 1, T0);
    t.recordFailure("198.51.100.0/24", T0 + 25 * 60 * 60 * 1000);
    expect(t.stats().keys).toBe(1);
  });
});
