import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AdminAuditRepo } from "../../db/repositories/admin-audit.js";
import { requireSession, type SessionConfig } from "../middleware.js";

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export function createAuditRoutes(cfg: SessionConfig, audit: AdminAuditRepo | undefined): Router {
  const r = Router();

  r.get("/api/admin/audit", requireSession(cfg), async (req: Request, res: Response) => {
    const q = Query.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    res.json({ items: (await audit?.list(q.data.limit)) ?? [] });
  });

  return r;
}
