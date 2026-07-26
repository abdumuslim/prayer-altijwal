import { Router, type Request, type Response } from "express";
import type { AdminAuditRepo } from "../db/repositories/admin-audit.js";
import { childLogger } from "../logger.js";
import { requireCsrf, type SessionConfig } from "./middleware.js";
import { createSessionRoutes } from "./routes/session.js";
import { createOverviewRoutes, type OverviewDeps } from "./routes/overview.js";
import { createMasjidRoutes, type MasjidAdminDeps } from "./routes/masjids.js";
import { createPlacesAdminRoutes, type PlacesAdminDeps } from "./routes/places.js";
import { createPushAdminRoutes, type PushAdminDeps } from "./routes/push.js";

const log = childLogger("admin");

export interface AdminRouterDeps
  extends OverviewDeps,
    MasjidAdminDeps,
    PlacesAdminDeps,
    PushAdminDeps {
  readonly session: SessionConfig;
  readonly audit?: AdminAuditRepo;
}

/**
 * The /api/admin surface. Mounted in app.ts BEFORE the permissive
 * `cors({ origin: true })` that covers the rest of /api, so admin responses
 * carry no CORS headers at all and are usable only same-origin.
 *
 * Built only when ADMIN_PASSWORD_HASH is configured; otherwise nothing is
 * mounted and every /api/admin path falls through to the generic /api 404,
 * so an unconfigured deployment doesn't advertise that the surface exists.
 */
export function createAdminRouter(deps: AdminRouterDeps): Router {
  const r = Router();

  // Express answers OPTIONS automatically for any path that has a registered
  // method, replying 200 with an `Allow:` list. That reply carries no CORS
  // headers so a browser preflight still fails — but there is no reason to
  // enumerate our methods for anyone who asks. Claim OPTIONS for the whole
  // subtree first and answer it exactly like an unknown path.
  r.options("/api/admin{/*splat}", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Applies to the whole subtree, including the catch-all below.
  r.use("/api/admin", requireCsrf());

  r.use(createSessionRoutes(deps.session, deps.audit));
  r.use(createOverviewRoutes(deps.session, deps));
  r.use(createMasjidRoutes(deps.session, deps));
  r.use(createPlacesAdminRoutes(deps.session, deps));
  r.use(createPushAdminRoutes(deps.session, deps));

  // Owns the entire subtree. Without this, an unmatched /api/admin request —
  // crucially including a cross-origin OPTIONS preflight — would fall through
  // to the permissive CORS middleware below and be answered with
  // Access-Control-Allow-Origin. Same-origin fetches never preflight, so
  // answering OPTIONS with 404 costs the dashboard nothing.
  r.all("/api/admin{/*splat}", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  log.info("Admin dashboard API mounted at /api/admin");
  return r;
}
