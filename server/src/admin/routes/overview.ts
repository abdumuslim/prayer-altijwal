import { Router, type Request, type Response } from "express";
import pg from "pg";
import type { DbStatus } from "../../health.js";
import type { PlacesGovernor } from "../../places/governor.js";
import { ptDayKey } from "../../places/budget.js";
import type { ResidentIndex } from "../../places/resident-index.js";
import { requireSession, type SessionConfig } from "../middleware.js";
import { fetchAudienceSummary, fetchCounts } from "../queries/overview.js";

/** Shape the push scheduler exposes for the dashboard (filled in from P2). */
export interface SchedulerSnapshot {
  running: boolean;
  lastTickAt: string | null;
  lastTickMs: number | null;
  sentToday: number;
  failedToday: number;
  goneRemovedToday: number;
}

export interface OverviewDeps {
  readonly serverVersion: string;
  readonly startedAt: number;
  readonly env: string;
  readonly getDbStatus: () => Promise<DbStatus>;
  readonly pool?: pg.Pool;
  readonly governor?: PlacesGovernor;
  readonly resident?: ResidentIndex;
  readonly getSchedulerStats?: () => SchedulerSnapshot;
  /** Browser-visible Embed-API key, forwarded so the UI never hard-codes it. */
  readonly embedKey?: string;
  readonly monthlyCap: number;
  readonly flags: {
    readonly placesEnabled: boolean;
    readonly pushEnabled: boolean;
    readonly telemetryEnabled: boolean;
  };
}

export function createOverviewRoutes(cfg: SessionConfig, deps: OverviewDeps): Router {
  const r = Router();

  r.get("/api/admin/overview", requireSession(cfg), async (_req: Request, res: Response) => {
    const startedDb = Date.now();
    const dbStatus = await deps.getDbStatus();
    const dbLatencyMs = Date.now() - startedDb;

    const [counts, audience, places] = await Promise.all([
      deps.pool ? fetchCounts(deps.pool) : null,
      deps.pool ? fetchAudienceSummary(deps.pool) : null,
      placesPlan(deps),
    ]);

    const communityApproved = counts?.communityApproved ?? 0;
    const residentTotal = deps.resident?.size ?? 0;

    // Every field below is named explicitly: no config object, no env, and no
    // raw database row is ever spread into an admin response.
    res.json({
      server: {
        version: deps.serverVersion,
        nodeVersion: process.version,
        uptimeSec: Math.floor((Date.now() - deps.startedAt) / 1000),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        env: deps.env,
        startedAt: new Date(deps.startedAt).toISOString(),
      },
      db: { status: dbStatus, latencyMs: dbLatencyMs },
      counts: {
        subscriptions: counts?.subscriptions ?? 0,
        alertRules: counts?.alertRules ?? 0,
        contributionsPending: counts?.contributionsPending ?? 0,
        contributionsTotal: counts?.contributionsTotal ?? 0,
        // The resident index holds the bundled OSM rows plus the approved
        // community layer; report them apart so growth is attributable.
        masjidsResident: Math.max(0, residentTotal - communityApproved),
        masjidsCommunity: communityApproved,
      },
      scheduler: deps.getSchedulerStats?.() ?? null,
      places,
      audience: audience ?? { activeToday: 0, activeYesterday: 0, avg7d: 0, avg30d: 0 },
      flags: {
        placesEnabled: deps.flags.placesEnabled,
        pushEnabled: deps.flags.pushEnabled,
        telemetryEnabled: deps.flags.telemetryEnabled,
      },
      embedKey: deps.embedKey ?? null,
    });
  });

  return r;
}

async function placesPlan(deps: OverviewDeps): Promise<Record<string, number | string> | null> {
  if (!deps.governor) return null;
  try {
    const plan = await deps.governor.plan();
    return {
      billingDay: ptDayKey(),
      monthlyCap: deps.monthlyCap,
      usedThisMonth: plan.usedThisMonth,
      activeClients: plan.activeClients,
      dailyPool: plan.dailyPool,
      reserve: plan.reserve,
      perClientCap: plan.perClientCap,
      perIpCap: plan.perIpCap,
    };
  } catch {
    // The governor is a spend guard, not a health check: a hiccup here must not
    // take the whole overview down.
    return null;
  }
}
