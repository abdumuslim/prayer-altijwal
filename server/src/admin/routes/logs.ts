import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { RING_CAPACITY, bufferedComponents, getRecentLogs } from "../../log-buffer.js";
import { requireSession, type SessionConfig } from "../middleware.js";

const Query = z.object({
  level: z.enum(["warn", "error"]).default("warn"),
  component: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(RING_CAPACITY).default(200),
});

export function createLogRoutes(cfg: SessionConfig): Router {
  const r = Router();

  r.get("/api/admin/logs", requireSession(cfg), (req: Request, res: Response) => {
    const q = Query.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    res.json({
      // Stated so the UI can be honest about what this view is.
      capacity: RING_CAPACITY,
      components: bufferedComponents(),
      items: getRecentLogs(q.data),
    });
  });

  return r;
}
