import { describe, it, expect, vi } from "vitest";
import { startRetention } from "./retention.js";
import { DEAD_SUBSCRIPTION_RETENTION_DAYS } from "./repositories/subscriptions.js";
import { CELL_DEMAND_RETENTION_DAYS } from "./repositories/places-stats.js";

describe("startRetention", () => {
  it("prunes ruleless subscriptions and cell demand with their own constants", async () => {
    const subscriptions = { pruneOrphaned: vi.fn(async () => 3) };
    const cellDemand = { pruneCellDemand: vi.fn(async () => 7) };

    // A long interval so the immediate sweep is the only one that runs here.
    const job = startRetention(
      { telemetryRetentionDays: 90, subscriptions, cellDemand },
      60_000,
    );
    await job.runNow();
    job.stop();

    expect(subscriptions.pruneOrphaned).toHaveBeenCalledWith(DEAD_SUBSCRIPTION_RETENTION_DAYS);
    expect(cellDemand.pruneCellDemand).toHaveBeenCalledWith(CELL_DEMAND_RETENTION_DAYS);
  });

  it("is a no-op for a policy whose repo was not supplied", async () => {
    // Only the subscription pruner is wired; the sweep must not throw over the
    // absent telemetry/audit/pushStats/placesUsage/cellDemand deps.
    const subscriptions = { pruneOrphaned: vi.fn(async () => 0) };
    const job = startRetention({ telemetryRetentionDays: 90, subscriptions }, 60_000);
    await expect(job.runNow()).resolves.toBeUndefined();
    job.stop();
    expect(subscriptions.pruneOrphaned).toHaveBeenCalled();
  });
});
