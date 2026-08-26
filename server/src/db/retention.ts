import { childLogger } from "../logger.js";
import type { AdminAuditRepo } from "./repositories/admin-audit.js";
import { AUDIT_RETENTION_DAYS } from "./repositories/admin-audit.js";
import type { PlacesUsageRepo } from "./repositories/places-usage.js";
import type { PlacesStatsRecorder } from "./repositories/places-stats.js";
import { CELL_DEMAND_RETENTION_DAYS } from "./repositories/places-stats.js";
import type { PushStatsRepo } from "./repositories/push-stats.js";
import { PUSH_STATS_RETENTION_DAYS } from "./repositories/push-stats.js";
import type { OrphanSubscriptionPruner } from "./repositories/subscriptions.js";
import { DEAD_SUBSCRIPTION_RETENTION_DAYS } from "./repositories/subscriptions.js";
import type { TelemetryRepo } from "./repositories/telemetry.js";

const log = childLogger("db/retention");

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionJob {
  stop(): void;
  /** Exposed for tests and for an operator-triggered sweep. */
  runNow(): Promise<void>;
}

export interface RetentionDeps {
  telemetry?: TelemetryRepo;
  telemetryRetentionDays: number;
  audit?: AdminAuditRepo;
  pushStats?: PushStatsRepo;
  /**
   * places_usage has had a prune() since ADR-014 but nothing ever called it —
   * the 90-day retention documented there was, in practice, forever.
   */
  placesUsage?: PlacesUsageRepo;
  /**
   * Ruleless push_subscriptions rows the scheduler never touches — they grew
   * forever until this pruner was wired in.
   */
  subscriptions?: OrphanSubscriptionPruner;
  /** places_cell_demand — an aggregate rollup that also had no retention. */
  cellDemand?: Pick<PlacesStatsRecorder, "pruneCellDemand">;
}

/**
 * One daily sweep for every retention policy, so the promises made in the
 * privacy policy are kept by code rather than by intention.
 */
export function startRetention(deps: RetentionDeps, intervalMs: number = DAY_MS): RetentionJob {
  const runNow = async (): Promise<void> => {
    const removed: Record<string, number> = {};
    try {
      if (deps.telemetry) {
        removed.usagePing = await deps.telemetry.prune(deps.telemetryRetentionDays);
      }
      if (deps.audit) removed.adminAudit = await deps.audit.prune(AUDIT_RETENTION_DAYS);
      if (deps.pushStats) removed.pushStats = await deps.pushStats.prune(PUSH_STATS_RETENTION_DAYS);
      if (deps.placesUsage) removed.placesUsage = await deps.placesUsage.prune();
      if (deps.subscriptions) {
        removed.deadSubscriptions = await deps.subscriptions.pruneOrphaned(
          DEAD_SUBSCRIPTION_RETENTION_DAYS,
        );
      }
      if (deps.cellDemand) {
        removed.cellDemand = await deps.cellDemand.pruneCellDemand(CELL_DEMAND_RETENTION_DAYS);
      }
      const total = Object.values(removed).reduce((a, b) => a + b, 0);
      if (total > 0) log.info("retention sweep removed rows", removed);
    } catch (err) {
      log.warn("retention sweep failed", err instanceof Error ? err : new Error(String(err)));
    }
  };

  void runNow();
  const timer = setInterval(() => void runNow(), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer), runNow };
}
