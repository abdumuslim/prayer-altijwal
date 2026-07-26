import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { childLogger } from "../../logger.js";
import type { AdminAuditRepo } from "../../db/repositories/admin-audit.js";
import {
  CONTRIBUTION_STATUSES,
  type ContributionRow,
  type ContributionStatus,
  type MasjidContributionsRepo,
} from "../../db/repositories/masjid-contributions.js";
import { haversineKm } from "../../util/geo-distance.js";
import { isSameMasjid } from "../../places/merge.js";
import type { ResidentIndex } from "../../places/resident-index.js";
import { actorIpOf, requireSession, type SessionConfig } from "../middleware.js";

const log = childLogger("admin/masjids");

/** How far around a submission to look for an existing masjid. */
const NEIGHBOUR_RADIUS_KM = 1;

export interface MasjidAdminDeps {
  readonly contributions?: MasjidContributionsRepo;
  readonly resident?: ResidentIndex;
  /** Pushes an approval into the live index immediately (community-refresh). */
  readonly refreshCommunity?: () => Promise<number>;
  readonly audit?: AdminAuditRepo;
}

const ListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const PatchBody = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
    name: z.string().trim().min(2).max(120).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

export function createMasjidRoutes(cfg: SessionConfig, deps: MasjidAdminDeps): Router {
  const r = Router();
  const guard = requireSession(cfg);

  r.get("/api/admin/masjids/contributions", guard, async (req: Request, res: Response) => {
    if (!deps.contributions) {
      res.json({ total: 0, items: [], enabled: false });
      return;
    }
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query" });
      return;
    }
    const { status, limit, offset } = parsed.data;
    const [rows, counts] = await Promise.all([
      deps.contributions.listByStatus(status, limit, offset),
      deps.contributions.counts(),
    ]);

    res.json({
      total: counts[status],
      counts,
      enabled: true,
      items: rows.map((row) => ({ ...toPublic(row), ...neighbourInfo(row, deps.resident) })),
    });
  });

  r.get("/api/admin/masjids/summary", guard, async (_req: Request, res: Response) => {
    const counts = (await deps.contributions?.counts()) ?? {
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    const total = deps.resident?.size ?? 0;
    res.json({
      ...counts,
      // The resident index is the bundled OSM rows plus the approved community
      // layer, so subtract to report the two apart.
      resident: Math.max(0, total - counts.approved),
      community: counts.approved,
    });
  });

  r.patch("/api/admin/masjids/contributions/:id", guard, async (req: Request, res: Response) => {
    if (!deps.contributions) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const updated = await deps.contributions.update(id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Approving (or un-approving) changes what the public endpoint serves, so
    // push it into the live index now instead of leaving the moderator to
    // wonder for up to ten minutes whether it worked.
    let liveCount: number | null = null;
    if (parsed.data.status !== undefined && deps.refreshCommunity) {
      try {
        liveCount = await deps.refreshCommunity();
      } catch (err) {
        log.warn("community refresh after moderation failed", err instanceof Error ? err : new Error(String(err)));
      }
    }

    void deps.audit?.append({
      action: `masjid.${parsed.data.status ?? "edit"}`,
      target: String(id),
      actorIp: actorIpOf(req),
      details: parsed.data,
    });
    log.info("masjid contribution moderated", { id, status: updated.status });

    res.json({ ok: true, item: { ...toPublic(updated), ...neighbourInfo(updated, deps.resident) }, liveCount });
  });

  return r;
}

/** Strips the client id down to a prefix — never return the whole identifier. */
function toPublic(row: ContributionRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lon: row.lon,
    status: row.status satisfies ContributionStatus,
    createdAt: row.createdAt,
    clientShort: row.clientId ? `${row.clientId.slice(0, 8)}…` : null,
  };
}

/**
 * Context a moderator needs to judge a submission: the closest masjid already
 * known, and whether the merge logic would treat this as the same building.
 * Reuses isSameMasjid so the dashboard's idea of "duplicate" is exactly the
 * one the serving path uses.
 */
function neighbourInfo(
  row: ContributionRow,
  resident: ResidentIndex | undefined,
): { nearest: { name: string; distanceM: number } | null; duplicate: boolean } {
  if (!resident) return { nearest: null, duplicate: false };

  const candidate = { id: `usr:${row.id}`, name: row.name, lat: row.lat, lon: row.lon, address: null };
  const neighbours = resident
    .nearest(row.lat, row.lon, NEIGHBOUR_RADIUS_KM, 8)
    // A masjid already approved from this same row is not its own duplicate.
    .filter((m) => m.id !== candidate.id);

  const closest = neighbours[0];
  return {
    nearest: closest
      ? {
          name: closest.name,
          distanceM: Math.round(haversineKm(row.lat, row.lon, closest.lat, closest.lon) * 1000),
        }
      : null,
    duplicate: neighbours.some((m) => isSameMasjid(m, candidate)),
  };
}

export const CONTRIBUTION_STATUS_VALUES = CONTRIBUTION_STATUSES;
