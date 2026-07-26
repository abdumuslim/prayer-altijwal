/**
 * Minimal cookie header handling for the admin session.
 *
 * Express has no built-in cookie parsing and the app carries exactly one cookie,
 * so this replaces the `cookie-parser` dependency with ~40 lines we can reason
 * about — see the "no new runtime dependencies" rule in the spec.
 */

/** The session cookie is only ever sent to the admin API, never to the app. */
export const COOKIE_PATH = "/api/admin";
export const SESSION_COOKIE = "padm";

/** A real Cookie header is a few hundred bytes; anything larger is noise or attack. */
const MAX_HEADER_LENGTH = 4096;

export interface CookieOptions {
  readonly maxAgeSec?: number;
  /** Set only in production — browsers reject Secure cookies on http://localhost. */
  readonly secure?: boolean;
}

/**
 * Parses a Cookie header into a name→value map. Never throws; malformed pairs
 * are skipped. The FIRST occurrence of a name wins, so a caller appending a
 * second `padm=` cannot shadow the browser's real one.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header || header.length > MAX_HEADER_LENGTH) return out;

  for (const segment of header.split(";")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const name = segment.slice(0, eq).trim();
    if (!name) continue;
    if (Object.prototype.hasOwnProperty.call(out, name)) continue;
    const raw = segment.slice(eq + 1).trim();
    out[name] = safeDecode(raw);
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (opts.maxAgeSec !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Expiring attributes must match the ones used to set it, or the browser keeps it. */
export function clearCookie(name: string, opts: CookieOptions): string {
  return serializeCookie(name, "", { ...opts, maxAgeSec: 0 });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // malformed %-escape: hand back the raw bytes rather than throwing
  }
}
