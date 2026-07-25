import { childLogger } from "../logger.js";
import type { ResidentIndex } from "./resident-index.js";
import type { MasjidContributionsRepo } from "../db/repositories/masjid-contributions.js";

const log = childLogger("places/community-refresh");

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export interface CommunityRefreshJob {
  stop(): void;
}

/**
 * Fold approved user contributions into the resident index (ADR-014).
 *
 * Approval happens out of band (psql — see docs/OPERATIONS.md), so the server
 * polls rather than being told. Ten minutes is well inside "the same day the
 * moderator approved it" and costs one trivial query.
 */
export function startCommunityRefresh(
  repo: MasjidContributionsRepo,
  index: ResidentIndex,
  intervalMs: number = REFRESH_INTERVAL_MS,
): CommunityRefreshJob {
  const run = (): void => {
    void repo
      .approved()
      .then((rows) => {
        index.setCommunity(rows);
        log.debug("community masjids refreshed", { count: rows.length });
      })
      .catch((err: unknown) => {
        log.warn("community refresh failed", err instanceof Error ? err : new Error(String(err)));
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
