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
    res.json({ ok: true, db });
  });
  return r;
}
