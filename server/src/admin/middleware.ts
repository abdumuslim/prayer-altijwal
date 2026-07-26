import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clientIpOf, ipPrefix } from "../places/identity.js";
import {
  SESSION_TTL_MS,
  issueSession,
  shouldRefresh,
  verifySession,
  type SessionPayload,
} from "./auth.js";
import { SESSION_COOKIE, clearCookie, parseCookies, serializeCookie } from "./cookie.js";

export interface SessionConfig {
  readonly passwordHash: string;
  readonly sessionSecret: string;
  /** False in local dev — browsers drop Secure cookies on http://localhost. */
  readonly secureCookies: boolean;
}

/** Where the verified session is stashed for downstream handlers. */
export interface AdminLocals {
  session?: SessionPayload;
}

/** Operator IP as a /24 or /64 PREFIX — the only form we ever store or log. */
export function actorIpOf(req: Request): string {
  return ipPrefix(clientIpOf(req));
}

export function setSessionCookie(res: Response, token: string, cfg: SessionConfig): void {
  res.setHeader(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, token, {
      maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
      secure: cfg.secureCookies,
    }),
  );
}

export function clearSessionCookie(res: Response, cfg: SessionConfig): void {
  res.setHeader("Set-Cookie", clearCookie(SESSION_COOKIE, { secure: cfg.secureCookies }));
}

/**
 * Rejects anything without a valid session cookie, and slides the expiry
 * forward while the operator is actually using the dashboard.
 */
export function requireSession(cfg: SessionConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const now = Date.now();
    const payload = token ? verifySession(token, cfg.sessionSecret, cfg.passwordHash, now) : null;

    if (!payload) {
      clearSessionCookie(res, cfg);
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (shouldRefresh(payload, now)) {
      const refreshed = issueSession(cfg.passwordHash, cfg.sessionSecret, now, payload.iat0);
      setSessionCookie(res, refreshed.token, cfg);
    }

    (res.locals as AdminLocals).session = payload;
    next();
  };
}

/**
 * Cross-site write protection. The admin API deliberately emits no CORS headers
 * (it is mounted ahead of the permissive `/api` CORS), and its cookie is
 * SameSite=Strict — this header requirement is the third lock: a form POST or
 * <img> from another origin cannot set a custom header.
 */
export function requireCsrf(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // OPTIONS is exempt so an unmatched preflight reaches the subtree catch-all
    // and gets a uniform 404 (it cannot mutate anything, and no admin route
    // handles it). Everything else that writes must carry the header.
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    if (req.get("X-Admin-Request") !== "1") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
