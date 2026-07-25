import { childLogger } from "../logger.js";
import { CACHE_MAX_AGE_DAYS, type PlacesCacheRepo } from "../db/repositories/places-cache.js";

const log = childLogger("places/cache-prune");

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CachePruneJob {
  stop(): void;
}

/**
 * Delete cached Places content past the 30-day retention limit.
 *
 * This job is the difference between complying with Google's caching terms and
 * merely appearing to: the read path already refuses stale rows, but the terms
 * require the content to be GONE, so something has to actually delete it. Runs
 * once at boot (a container that restarts daily would otherwise never reach the
 * first interval) and daily thereafter.
 */
export function startCachePrune(repo: PlacesCacheRepo, intervalMs: number = DAY_MS): CachePruneJob {
  const run = (): void => {
    void repo.prune().catch((err: unknown) => {
      log.warn("prune tick failed", err instanceof Error ? err : new Error(String(err)));
    });
  };

  run();
  const timer = setInterval(run, intervalMs);
  // Never hold the process open on this alone.
  timer.unref();
  log.info("places_cache prune job started", { maxAgeDays: CACHE_MAX_AGE_DAYS });

  return { stop: () => clearInterval(timer) };
}
