import type { Request } from "express";

/**
 * Anonymous request identity for quota accounting (ADR-014).
 *
 * Two identifiers, neither of which identifies a person:
 *  - a random UUID the app generates for itself and stores locally, and
 *  - the caller's IP PREFIX (/24 or /64), never the full address.
 *
 * The client id is trivially forgeable — a sweeper can mint a new one per
 * request — which is exactly why the IP prefix cap sits behind it. The client id
 * makes the limits fair for real users sharing a NAT; the IP prefix makes them
 * enforceable.
 */

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Strip the IPv6-mapped-IPv4 prefix Node reports for v4 sockets. */
function unmap(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** Reduce an address to the prefix we actually count against. */
export function ipPrefix(raw: string): string {
  const ip = unmap(raw.trim());
  if (ip === "") return "unknown";

  if (ip.includes(".") && !ip.includes(":")) {
    const octets = ip.split(".");
    if (octets.length !== 4) return "unknown";
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  if (ip.includes(":")) {
    // Expand only as far as needed: the first four hextets are the /64.
    const [head] = ip.split("%"); // drop any zone index
    const parts = (head ?? "").split(":");
    const kept: string[] = [];
    for (const p of parts) {
      if (kept.length === 4) break;
      if (p === "") break; // hit the "::" run — the prefix is already shorter
      kept.push(p);
    }
    if (kept.length === 0) return "unknown";
    return `${kept.join(":")}::/64`;
  }

  return "unknown";
}

/**
 * The caller's address as seen through Cloudflare + Traefik.
 *
 * Express's `req.ip` is the PROXY's address unless `trust proxy` is configured,
 * which would bucket every user in the world into one counter — so the headers
 * are read explicitly instead.
 */
export function clientIpOf(req: Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim() !== "") return cf.trim();

  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  if (first) return first;

  return req.socket.remoteAddress ?? "";
}

/** Anonymous per-installation id, falling back to the IP prefix. */
export function clientIdOf(req: Request, ipKey: string): string {
  const raw = req.headers["x-client-id"];
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (typeof id === "string" && CLIENT_ID_RE.test(id)) return id;
  return `ip:${ipKey}`;
}
