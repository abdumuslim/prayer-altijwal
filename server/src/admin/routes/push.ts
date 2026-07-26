import { Router, type Request, type Response } from "express";
import pg from "pg";
import { z } from "zod";
import { childLogger } from "../../logger.js";
import type { AdminAuditRepo } from "../../db/repositories/admin-audit.js";
import type { SubscriptionsRepo } from "../../db/repositories/subscriptions.js";
import { actorIpOf, requireSession, type SessionConfig } from "../middleware.js";
import { fetchPushSummary, fetchSubscribers } from "../queries/push.js";

const log = childLogger("admin/push");

export interface PushAdminDeps {
  readonly pool?: pg.Pool;
  readonly subsRepo?: SubscriptionsRepo;
  readonly audit?: AdminAuditRepo;
}

const SummaryQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export function createPushAdminRoutes(cfg: SessionConfig, deps: PushAdminDeps): Router {
  const r = Router();
  const guard = requireSession(cfg);

  r.get("/api/admin/push/summary", guard, async (req: Request, res: Response) => {
    const q = SummaryQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    if (!deps.pool) {
      res.json({ enabled: false });
      return;
    }
    const [summary, subscribers] = await Promise.all([
      fetchPushSummary(deps.pool, q.data.days),
      fetchSubscribers(deps.pool, q.data.limit),
    ]);
    res.json({ enabled: true, ...summary, subscribers });
  });

  r.delete("/api/admin/push/subscriptions/:id", guard, async (req: Request, res: Response) => {
    if (!deps.subsRepo) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    let removed = false;
    try {
      removed = await deps.subsRepo.deleteById(id);
    } catch (err) {
      log.error("subscription delete failed", err instanceof Error ? err : new Error(String(err)));
      res.status(500).json({ error: "Delete failed" });
      return;
    }
    if (!removed) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    // Deleting a subscription cascades to its rules and its fire ledger.
    void deps.audit?.append({
      action: "push.subscription.delete",
      target: String(id),
      actorIp: actorIpOf(req),
    });
    res.status(204).end();
  });

  return r;
}
