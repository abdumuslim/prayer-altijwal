import { Router, type Request, type Response } from "express";
import pg from "pg";
import { z } from "zod";
import { requireSession, type SessionConfig } from "../middleware.js";
import { fetchAudience } from "../queries/audience.js";

export interface AudienceAdminDeps {
  readonly pool?: pg.Pool;
  readonly telemetryConfigured: boolean;
  readonly precisionDeg: number;
  readonly retentionDays: number;
}

const Query = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export function createAudienceRoutes(cfg: SessionConfig, deps: AudienceAdminDeps): Router {
  const r = Router();

  r.get("/api/admin/audience", requireSession(cfg), async (req: Request, res: Response) => {
    const q = Query.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }

    const report = deps.pool ? await fetchAudience(deps.pool, q.data.days) : null;
    res.json({
      configured: deps.telemetryConfigured,
      // Surfaced so the UI can state the actual precision and retention rather
      // than hard-coding numbers that might drift from the deployment.
      precisionDeg: deps.precisionDeg,
      retentionDays: deps.retentionDays,
      ...(report ?? { empty: true }),
    });
  });

  return r;
}
