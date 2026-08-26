import { childLogger } from "../logger.js";
import type { ResidentIndex } from "./resident-index.js";
import type { MasjidContributionsRepo } from "../db/repositories/masjid-contributions.js";
import { isExcludedVenue } from "./venue-filter.js";
import { isInIraqBbox } from "./iraq-bbox.js";

const log = childLogger("places/community-refresh");

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export interface CommunityRefreshJob {
  stop(): void;
  /**
   * Refresh immediately and report how many approved masjids are now live.
   * The admin dashboard calls this straight after an approval so the moderator
   * can confirm the masjid is actually searchable, instead of being told to
   * wait up to ten minutes and hope.
   */
  refreshNow(): Promise<number>;
}

/**
 * Fold approved user contributions into the resident index (ADR-014).
 *
 * The poll remains the safety net: approvals normally arrive through
 * /admin (which calls refreshNow), but a direct psql UPDATE still takes effect
 * within ten minutes, and the poll re-seeds the index after a restart.
 */
export function startCommunityRefresh(
  repo: MasjidContributionsRepo,
  index: ResidentIndex,
  intervalMs: number = REFRESH_INTERVAL_MS,
): CommunityRefreshJob {
  const refresh = async (): Promise<number> => {
    // Apply the shared venue filter at the serving boundary: a contribution named
    // like a husseiniya/mawkib/mudhif must never reach the served index, even if
    // it was approved. Invisible to the contributor by design — nothing is
    // rejected at submit time (see venue-filter.ts, the single source of truth).
    // Also drop any row pinned outside the Iraq bbox: submission geofences the
    // pin, but an operator edit could move an approved row out, and the resident
    // index is Iraq-only.
    const rows = (await repo.approved()).filter(
      (m) => !isExcludedVenue(m.name) && isInIraqBbox(m.lat, m.lon),
    );
    index.setCommunity(rows);
    log.debug("community masjids refreshed", { count: rows.length });
    return rows.length;
  };

  const run = (): void => {
    void refresh().catch((err: unknown) => {
      log.warn("community refresh failed", err instanceof Error ? err : new Error(String(err)));
    });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), refreshNow: refresh };
}
