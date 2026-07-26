import { Router, type Request, type Response } from "express";
import pg from "pg";
import { z } from "zod";
import type { PlacesGovernor } from "../../places/governor.js";
import { ptDayKey, ptMonthKey } from "../../places/budget.js";
import { requireSession, type SessionConfig } from "../middleware.js";
import {
  PLACES_OUTCOMES,
  fetchDailyOutcomes,
  fetchDemand,
  fetchHourlyOutcomes,
  fetchTopClients,
} from "../queries/places.js";

export interface PlacesAdminDeps {
  readonly pool?: pg.Pool;
  readonly governor?: PlacesGovernor;
  readonly monthlyCap: number;
}

const DaysQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(2000).default(25),
});

export function createPlacesAdminRoutes(cfg: SessionConfig, deps: PlacesAdminDeps): Router {
  const r = Router();
  const guard = requireSession(cfg);

  r.get("/api/admin/places/stats", guard, async (req: Request, res: Response) => {
    const days = DaysQuery.safeParse(req.query);
    if (!days.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    if (!deps.pool) {
      res.json({ daily: [], hourlyToday: [], outcomes: PLACES_OUTCOMES, plan: null });
      return;
    }

    const [daily, hourlyToday, plan] = await Promise.all([
      fetchDailyOutcomes(deps.pool, days.data.days),
      fetchHourlyOutcomes(deps.pool),
      planOrNull(deps),
    ]);

    res.json({
      // Sent so the UI colours a fixed, known set of series rather than
      // whatever happened to appear in the window.
      outcomes: PLACES_OUTCOMES,
      billingDay: ptDayKey(),
      billingMonth: ptMonthKey(),
      daily,
      hourlyToday,
      plan,
    });
  });

  r.get("/api/admin/places/top-clients", guard, async (req: Request, res: Response) => {
    const q = DaysQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const items = deps.pool ? await fetchTopClients(deps.pool, q.data.days, q.data.limit) : [];
    res.json({ items });
  });

  r.get("/api/admin/places/demand", guard, async (req: Request, res: Response) => {
    const q = DaysQuery.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "Invalid query" });
      return;
    }
    const items = deps.pool ? await fetchDemand(deps.pool, q.data.days, q.data.limit) : [];
    res.json({ items });
  });

  return r;
}

async function planOrNull(deps: PlacesAdminDeps): Promise<Record<string, number> | null> {
  if (!deps.governor) return null;
  try {
    const plan = await deps.governor.plan();
    return {
      monthlyCap: deps.monthlyCap,
      usedThisMonth: plan.usedThisMonth,
      activeClients: plan.activeClients,
      dailyPool: plan.dailyPool,
      reserve: plan.reserve,
      perClientCap: plan.perClientCap,
      perIpCap: plan.perIpCap,
    };
  } catch {
    return null;
  }
}
