import { createHash, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Admin authentication primitives — pure, dependency-free, unit-tested.
 *
 * Two secrets are involved and they do different jobs:
 *   - ADMIN_PASSWORD_HASH  proves *who* is logging in (scrypt digest).
 *   - ADMIN_SESSION_SECRET proves a cookie was minted *by us* (HMAC key).
 *
 * The session is stateless: there is no sessions table, and no server-side
 * revocation list. Instead every cookie carries a fingerprint of the password
 * digest, so changing the password invalidates every outstanding session — the
 * one revocation lever a single-operator dashboard actually needs.
 */

/** Idle lifetime: a cookie is re-issued while in use, and dies 12h after last use. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Hard ceiling from first login, regardless of activity. */
export const ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-issue once more than an hour of the idle window has been consumed. */
export const REFRESH_WHEN_REMAINING_MS = 11 * 60 * 60 * 1000;

/** Production scrypt cost. Travels inside the digest, so raising it later
 *  doesn't invalidate existing hashes. Must match scripts/hash-admin-password.mjs. */
export const DEFAULT_SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/**
 * Field separator for the digest. NOT `$` (the conventional PHC choice):
 * this value lives in the VPS `.env`, which Docker Compose loads via
 * `env_file` — and Compose performs variable interpolation on those values,
 * so `scrypt$16384$8$1$<salt>$<hash>` reaches the container with `$<salt>`
 * and part of `$1...` replaced by empty strings. That silently truncated the
 * digest and made every login fail with no useful error.
 *
 * `:` is unambiguous here because every other field is base64url (`A-Za-z0-9_-`)
 * or a decimal integer. See the "no dollar sign" test in auth.test.ts.
 */
const SEP = ":";
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Refuse a digest whose parameters would let a hostile .env wedge the process
 *  on every login attempt. 128*N*r bytes is scrypt's working-set formula. */
const MAX_SCRYPT_MEMORY_BYTES = 64 * 1024 * 1024;

export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

export interface SessionPayload {
  readonly v: 1;
  /** First login of this session chain — preserved across re-issues. */
  readonly iat0: number;
  readonly exp: number;
  /** Fingerprint of the password digest this session was minted against. */
  readonly pf: string;
}

/** Builds a `scrypt$N$r$p$salt$hash` digest. */
export function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT_PARAMS): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEYLEN, {
    ...params,
    maxmem: memoryFor(params),
  });
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join(SEP);
}

/**
 * Constant-time password check. Returns false for every malformed input rather
 * than throwing: a corrupt ADMIN_PASSWORD_HASH must fail login, not 500 the route.
 */
export function verifyPassword(password: string, digest: string): boolean {
  const parsed = parseDigest(digest);
  if (!parsed) return false;
  try {
    const actual = scryptSync(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: memoryFor(parsed),
    });
    return timingSafeEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}

/**
 * Same check, off the event loop. scrypt is deliberately slow (~80 ms at the
 * production cost), and this server also answers prayer-times for everyone —
 * a burst of login attempts must not stall those. Node runs the async form on
 * the threadpool, so use THIS one in request handlers; the sync form is for
 * tests and the hashing script.
 */
export function verifyPasswordAsync(password: string, digest: string): Promise<boolean> {
  const parsed = parseDigest(digest);
  if (!parsed) return Promise.resolve(false);
  return new Promise((resolve) => {
    scrypt(
      password,
      parsed.salt,
      parsed.hash.length,
      { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: memoryFor(parsed) },
      (err, actual) => {
        if (err || !actual) {
          resolve(false);
          return;
        }
        try {
          resolve(timingSafeEqual(actual, parsed.hash));
        } catch {
          resolve(false);
        }
      },
    );
  });
}

/** Short, non-reversible tag identifying *which* password a session belongs to. */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export interface IssuedSession {
  readonly token: string;
  readonly expiresAt: number;
  readonly payload: SessionPayload;
}

/** Mints a cookie value. Pass `iat0` when refreshing so the 7-day cap survives. */
export function issueSession(
  passwordHash: string,
  secret: string,
  nowMs: number,
  iat0: number = nowMs,
): IssuedSession {
  const payload: SessionPayload = {
    v: 1,
    iat0,
    exp: nowMs + SESSION_TTL_MS,
    pf: passwordFingerprint(passwordHash),
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${body}.${sign(body, secret)}`, expiresAt: payload.exp, payload };
}

/**
 * Validates a cookie value. Returns the payload, or null for ANY failure —
 * bad shape, bad signature, expired, past the absolute cap, or minted against a
 * different password. Never throws.
 */
export function verifySession(
  token: string,
  secret: string,
  passwordHash: string,
  nowMs: number,
): SessionPayload | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  // Signature first: nothing downstream parses attacker-controlled bytes until
  // we know we minted them. Compare the ENCODED strings, not decoded bytes:
  // base64url's final character carries unused padding bits, so distinct
  // signature strings can decode to identical bytes, and Buffer's decoder
  // silently drops invalid characters. String comparison admits neither.
  const expected = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(sig, "utf8");
  if (given.length !== expected.length) return null; // timingSafeEqual throws on length mismatch
  if (!timingSafeEqual(given, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (payload.v !== 1) return null;
  if (!Number.isFinite(payload.iat0) || !Number.isFinite(payload.exp)) return null;
  if (typeof payload.pf !== "string") return null;

  if (nowMs >= payload.exp) return null;
  if (nowMs >= payload.iat0 + ABSOLUTE_TTL_MS) return null;
  if (payload.pf !== passwordFingerprint(passwordHash)) return null;

  return payload;
}

/** True once enough of the idle window has elapsed to be worth re-issuing. */
export function shouldRefresh(payload: SessionPayload, nowMs: number): boolean {
  return payload.exp - nowMs < REFRESH_WHEN_REMAINING_MS;
}

// ── internals ────────────────────────────────────────────────────────────────

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function memoryFor(params: ScryptParams): number {
  return 128 * params.N * params.r + 1024 * 1024;
}

interface ParsedDigest extends ScryptParams {
  readonly salt: Buffer;
  readonly hash: Buffer;
}

function parseDigest(digest: string): ParsedDigest | null {
  if (typeof digest !== "string") return null;
  const parts = digest.split(SEP);
  if (parts.length !== 6) return null;
  const [scheme, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (scheme !== "scrypt") return null;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N < 2 || (N & (N - 1)) !== 0) return null; // scrypt requires a power of two
  if (r < 1 || r > 32 || p < 1 || p > 16) return null;
  if (128 * N * r > MAX_SCRYPT_MEMORY_BYTES) return null;

  // Buffer's base64url decoding is lenient (it drops invalid characters rather
  // than throwing), so garbage lands here as short/empty buffers — rejected next.
  const salt = Buffer.from(rawSalt, "base64url");
  const hash = Buffer.from(rawHash, "base64url");
  if (salt.length === 0 || hash.length < 16) return null;

  return { N, r, p, salt, hash };
}
