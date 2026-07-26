import { describe, it, expect } from "vitest";
import {
  ABSOLUTE_TTL_MS,
  SESSION_TTL_MS,
  hashPassword,
  issueSession,
  passwordFingerprint,
  shouldRefresh,
  verifyPassword,
  verifyPasswordAsync,
  verifySession,
} from "./auth.js";

// Cheap scrypt parameters keep the suite fast; the production cost lives in the
// digest string itself, so the verifier is exercised identically either way.
const FAST = { N: 1024, r: 8, p: 1 } as const;
const SECRET = "test-session-secret-at-least-32-chars-long";
const T0 = Date.UTC(2026, 6, 26, 12, 0, 0);

describe("verifyPassword", () => {
  const digest = hashPassword("correct horse battery", FAST);

  it("accepts the right password", () => {
    expect(verifyPassword("correct horse battery", digest)).toBe(true);
  });

  it("rejects the wrong password", () => {
    expect(verifyPassword("correct horse batter", digest)).toBe(false);
    expect(verifyPassword("", digest)).toBe(false);
  });

  it("returns false (never throws) on a malformed digest", () => {
    for (const bad of [
      "",
      "not-a-digest",
      "scrypt:1024:8",
      "scrypt:1024:8:1:onlyfoursegments",
      "bcrypt:1024:8:1:c2FsdA:aGFzaA",
      "scrypt:abc:8:1:c2FsdA:aGFzaA",
      "scrypt:1024:8:1:!!!:!!!",
      // The old PHC-style separator must no longer parse (see below).
      "scrypt$1024$8$1$c2FsdA$aGFzaA",
    ]) {
      expect(() => verifyPassword("x", bad)).not.toThrow();
      expect(verifyPassword("x", bad)).toBe(false);
    }
  });

  it("refuses absurd cost parameters instead of exhausting memory", () => {
    // A hostile .env must not be able to wedge the process on every login.
    expect(verifyPassword("x", `scrypt:${2 ** 30}:8:1:c2FsdA:aGFzaA`)).toBe(false);
  });

  it("never puts a '$' in the digest", () => {
    // REGRESSION (2026-07-26, found in production): the digest lives in the VPS
    // .env, which Docker Compose loads via `env_file` — and Compose interpolates
    // variables in those values. A PHC-style `scrypt$16384$8$1$<salt>$<hash>`
    // arrived at the container with `$<salt>` and part of `$1...` replaced by
    // empty strings, silently truncating it so every login failed with no
    // useful error. Keep the separator free of shell-significant characters.
    for (let i = 0; i < 5; i++) {
      expect(hashPassword(`sample ${i}`, FAST)).not.toContain("$");
    }
  });

  it("produces a different digest for the same password each time (random salt)", () => {
    expect(hashPassword("same", FAST)).not.toBe(hashPassword("same", FAST));
  });

  it("agrees with the async variant used by the route handler", async () => {
    await expect(verifyPasswordAsync("correct horse battery", digest)).resolves.toBe(true);
    await expect(verifyPasswordAsync("wrong", digest)).resolves.toBe(false);
    await expect(verifyPasswordAsync("x", "garbage")).resolves.toBe(false);
    await expect(verifyPasswordAsync("x", `scrypt:${2 ** 30}:8:1:c2FsdA:aGFzaA`)).resolves.toBe(
      false,
    );
  });
});

describe("session cookies", () => {
  const hash = hashPassword("operator password", FAST);

  it("round-trips a freshly issued session", () => {
    const { token, expiresAt } = issueSession(hash, SECRET, T0);
    expect(expiresAt).toBe(T0 + SESSION_TTL_MS);
    const payload = verifySession(token, SECRET, hash, T0 + 1000);
    expect(payload).not.toBeNull();
    expect(payload?.iat0).toBe(T0);
  });

  it("rejects a tampered signature", () => {
    const { token } = issueSession(hash, SECRET, T0);
    const [body, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifySession(`${body}.${flipped}`, SECRET, hash, T0)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const { token } = issueSession(hash, SECRET, T0);
    const sig = token.split(".")[1];
    const forged = Buffer.from(
      JSON.stringify({ v: 1, iat0: T0, exp: T0 + ABSOLUTE_TTL_MS, pf: passwordFingerprint(hash) }),
    ).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, SECRET, hash, T0)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = issueSession(hash, SECRET, T0);
    expect(verifySession(token, "another-secret-at-least-32-characters", hash, T0)).toBeNull();
  });

  it("returns null (never throws) on malformed tokens", () => {
    const { token } = issueSession(hash, SECRET, T0);
    const [body, sig] = token.split(".");
    for (const bad of [
      "",
      "onlyonesegment",
      "a.b.c",
      ".",
      `${body}.`,
      `.${sig}`,
      `${body}.${sig.slice(0, 4)}`, // truncated signature — unequal buffer lengths
      `!!!not-base64!!!.${sig}`,
      `${Buffer.from("not json").toString("base64url")}.${sig}`,
    ]) {
      expect(() => verifySession(bad, SECRET, hash, T0)).not.toThrow();
      expect(verifySession(bad, SECRET, hash, T0)).toBeNull();
    }
  });

  it("expires after the idle TTL", () => {
    const { token } = issueSession(hash, SECRET, T0);
    expect(verifySession(token, SECRET, hash, T0 + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(verifySession(token, SECRET, hash, T0 + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("enforces the absolute cap even across re-issues", () => {
    // Simulate an operator active every few hours for over a week: each request
    // re-issues, but iat0 travels unchanged so the 7-day ceiling still lands.
    let token = issueSession(hash, SECRET, T0).token;
    let now = T0;
    for (let i = 0; i < 40; i++) {
      now += 4 * 60 * 60 * 1000; // 4h
      const payload = verifySession(token, SECRET, hash, now);
      if (!payload) break;
      token = issueSession(hash, SECRET, now, payload.iat0).token;
    }
    expect(verifySession(token, SECRET, hash, T0 + ABSOLUTE_TTL_MS - 1)).not.toBeNull();
    expect(verifySession(token, SECRET, hash, T0 + ABSOLUTE_TTL_MS + 1)).toBeNull();
  });

  it("is invalidated by a password change", () => {
    const { token } = issueSession(hash, SECRET, T0);
    const newHash = hashPassword("a different password", FAST);
    expect(verifySession(token, SECRET, hash, T0)).not.toBeNull();
    expect(verifySession(token, SECRET, newHash, T0)).toBeNull();
  });

  it("refreshes only once the session is meaningfully used", () => {
    const { token } = issueSession(hash, SECRET, T0);
    const fresh = verifySession(token, SECRET, hash, T0 + 60_000);
    expect(shouldRefresh(fresh!, T0 + 60_000)).toBe(false);
    const older = verifySession(token, SECRET, hash, T0 + 2 * 60 * 60 * 1000);
    expect(shouldRefresh(older!, T0 + 2 * 60 * 60 * 1000)).toBe(true);
  });
});

describe("passwordFingerprint", () => {
  it("is stable, short, and changes with the digest", () => {
    const a = hashPassword("one", FAST);
    const b = hashPassword("two", FAST);
    expect(passwordFingerprint(a)).toBe(passwordFingerprint(a));
    expect(passwordFingerprint(a)).toHaveLength(16);
    expect(passwordFingerprint(a)).not.toBe(passwordFingerprint(b));
  });
});
