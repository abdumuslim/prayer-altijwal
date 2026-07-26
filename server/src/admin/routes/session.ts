import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { childLogger } from "../../logger.js";
import type { AdminAuditRepo } from "../../db/repositories/admin-audit.js";
import { issueSession, verifyPasswordAsync } from "../auth.js";
import { createLoginThrottle } from "../rate-limit.js";
import {
  actorIpOf,
  clearSessionCookie,
  requireSession,
  setSessionCookie,
  type AdminLocals,
  type SessionConfig,
} from "../middleware.js";

const log = childLogger("admin/session");

/**
 * Concurrency cap on password hashing. The throttle only records a failure
 * AFTER the hash completes, so without this a burst of simultaneous requests
 * would all get through the check at once and saturate the crypto threadpool.
 */
const MAX_CONCURRENT_VERIFICATIONS = 2;

const LoginSchema = z.object({
  // Bounded so an oversized body can't be turned into work; the real limit is
  // express.json's 16kb, this just fails fast and uniformly.
  password: z.string().min(1).max(512),
});

export function createSessionRoutes(cfg: SessionConfig, audit: AdminAuditRepo | undefined): Router {
  const r = Router();
  const throttle = createLoginThrottle();
  let inFlight = 0;

  r.post("/api/admin/session", async (req: Request, res: Response) => {
    const ip = actorIpOf(req);
    const now = Date.now();

    const decision = throttle.check(ip, now);
    if (!decision.allowed) {
      res.set("Retry-After", String(decision.retryAfterSec));
      res.status(429).json({ error: "Too many attempts" });
      return;
    }
    if (inFlight >= MAX_CONCURRENT_VERIFICATIONS) {
      res.set("Retry-After", "2");
      res.status(429).json({ error: "Too many attempts" });
      return;
    }

    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      throttle.recordFailure(ip, now);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    let ok = false;
    inFlight += 1;
    try {
      ok = await verifyPasswordAsync(parsed.data.password, cfg.passwordHash);
    } finally {
      inFlight -= 1;
    }

    if (!ok) {
      throttle.recordFailure(ip, now);
      // Audit only the moment a lockout STARTS, never each attempt — otherwise
      // anyone on the internet could grow admin_audit without limit.
      const after = throttle.check(ip, Date.now());
      if (!after.allowed) {
        log.warn("admin login locked out", { ip, reason: after.reason });
        void audit?.append({ action: "session.lockout", actorIp: ip, details: { reason: after.reason } });
      }
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    throttle.recordSuccess(ip, now);
    const session = issueSession(cfg.passwordHash, cfg.sessionSecret, now);
    setSessionCookie(res, session.token, cfg);
    log.info("admin login", { ip });
    void audit?.append({ action: "session.login", actorIp: ip });
    res.status(204).end();
  });

  r.get("/api/admin/session", requireSession(cfg), (_req: Request, res: Response) => {
    const session = (res.locals as AdminLocals).session;
    res.json({ ok: true, expiresAt: session ? new Date(session.exp).toISOString() : null });
  });

  r.delete("/api/admin/session", (_req: Request, res: Response) => {
    clearSessionCookie(res, cfg);
    res.status(204).end();
  });

  return r;
}
