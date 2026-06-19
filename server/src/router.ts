import { Router } from "express";
import { createHealthRouter, type DbStatus } from "./health.js";

export interface RouterDeps {
  getDbStatus: () => Promise<DbStatus>;
  /** Feature sub-routers (prayer-times, geo, push) wired in by index.ts as phases land. */
  featureRouters?: Router[];
}

/** Central API router. Mounts health + any provided feature routers. */
export function createRouter(deps: RouterDeps): Router {
  const r = Router();
  r.use(createHealthRouter(deps.getDbStatus));
  for (const fr of deps.featureRouters ?? []) {
    r.use(fr);
  }
  return r;
}
