/**
 * Anonymous per-installation identifier (ADR-014).
 *
 * Sent as `X-Client-Id` on the paid Places endpoints so the server can give each
 * installation a fair share of the daily budget instead of throttling everyone
 * behind one shared IP. It is a random value with no link to a person, device,
 * or location — the server stores it only against daily request/spend counts,
 * never against coordinates.
 *
 * Kept out of `prayer.app.v1`: that envelope is user SETTINGS, rewritten on
 * every preference change, and an identity has different lifecycle rules.
 */

const KEY = "prayer.client.v1";

/** Matches the server's accepted shape (places/identity.ts CLIENT_ID_RE). */
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

function generate(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Older Android WebViews have getRandomValues but not randomUUID.
  if (c && typeof c.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Last resort: still unique enough to separate installations for quota
  // purposes, which is all this value is ever used for.
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

let cached: string | null = null;

/** The stable id for this installation, created on first use. */
export function getClientId(): string {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && VALID.test(stored)) {
      cached = stored;
      return stored;
    }
  } catch {
    // Storage unavailable — fall through and use a per-session id.
  }

  const fresh = generate();
  cached = fresh;
  try {
    localStorage.setItem(KEY, fresh);
  } catch {
    // Private mode: the id lives for this session only, which still works.
  }
  return fresh;
}
