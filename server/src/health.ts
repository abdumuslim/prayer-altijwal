import { Router, type Request, type Response } from "express";

export type DbStatus = "up" | "down" | "disabled";

/** Lightweight liveness + DB-connectivity probe (used by the Docker healthcheck). */
export function createHealthRouter(getDbStatus: () => Promise<DbStatus>): Router {
  const r = Router();
  r.get("/api/health", async (_req: Request, res: Response) => {
    let db: DbStatus = "disabled";
    try {
      db = await getDbStatus();
    } catch {
      db = "down";
    }
    // Liveness stays 200 while the process is up, so the Docker healthcheck and
    // Traefik keep routing unchanged. `degraded` is additive: it surfaces a DB
    // that is configured but currently unreachable (the stateless-fallback mode)
    // without repurposing the status code. A deliberately DB-less deploy
    // ("disabled") is not degraded.
    res.json({ ok: true, db, degraded: db === "down" });
  });
  return r;
}
