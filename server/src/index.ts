import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { childLogger } from "./logger.js";
import { createApp } from "./app.js";
import { createRouter } from "./router.js";
import type { DbStatus } from "./health.js";
import { createPrayerRouter } from "./prayer/routes.js";
import { CitiesIndex } from "./geo/cities-index.js";
import { createGeoRouter } from "./geo/routes.js";
import { createPlacesRouter } from "./places/routes.js";
import { startCachePrune, type CachePruneJob } from "./places/cache-prune.js";
import { createPlacesGovernor, type PlacesGovernor } from "./places/governor.js";
import { ResidentIndex } from "./places/resident-index.js";
import { startCommunityRefresh, type CommunityRefreshJob } from "./places/community-refresh.js";
import {
  createMasjidContributionsRepo,
  type MasjidContributionsRepo,
} from "./db/repositories/masjid-contributions.js";
import { createPool, dbHealth } from "./db/pool.js";
import { createPlacesCacheRepo, type PlacesCacheRepo } from "./db/repositories/places-cache.js";
import { createPlacesUsageRepo } from "./db/repositories/places-usage.js";
import {
  createPlacesStatsRecorder,
  type PlacesStatsRecorder,
} from "./db/repositories/places-stats.js";
import { initDb } from "./db/schema.js";
import { PgSubscriptionsRepo } from "./db/repositories/subscriptions.js";
import { PgPushLogRepo } from "./db/repositories/push-log.js";
import { PgAlertRulesRepo } from "./db/repositories/alert-rules.js";
import { setupWebPush } from "./push/webpush.js";
import { PrayerScheduler } from "./push/scheduler.js";
import { createPushRouter } from "./push/routes.js";
import { createAdminRouter } from "./admin/index.js";
import { createAdminAuditRepo, type AdminAuditRepo } from "./db/repositories/admin-audit.js";
import { createPushStatsRepo, type PushStatsRepo } from "./db/repositories/push-stats.js";
import { createAppSettings, type AppSettingsRepo } from "./db/repositories/app-settings.js";
import { createTelemetryRepo, type TelemetryRepo } from "./db/repositories/telemetry.js";
import { createTelemetryRouter } from "./telemetry/routes.js";
import { startRetention, type RetentionJob } from "./db/retention.js";
import { SETTING_KEYS } from "./admin/routes/settings.js";
import { registerRedactedSecrets } from "./log-buffer.js";

const log = childLogger("index");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Deployed server version, shown on the admin overview. */
const SERVER_VERSION = ((): string => {
  try {
    const raw = readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
})();

type Pool = Awaited<ReturnType<typeof createPool>>;

async function main(): Promise<void> {
  // Geo index — stateless, always available.
  const citiesIndex = CitiesIndex.load();
  log.info(`Loaded cities index (${citiesIndex.size} cities)`);

  // Free OSM/community masjids — the floor under the nearest-masjid feature
  // (ADR-014). A missing dataset is not fatal: the feature just leans on Google.
  const residentMasjids = ResidentIndex.load();

  const featureRouters = [createPrayerRouter(), createGeoRouter(citiesIndex)];

  // DB + push are optional. Degrade to stateless (public prayer-times still
  // works) rather than crash-looping if the SHARED Postgres is briefly down.
  let pool: Pool | undefined;
  let scheduler: PrayerScheduler | undefined;
  let cachePrune: CachePruneJob | undefined;
  let placesCacheRepo: PlacesCacheRepo | undefined;
  let placesGovernor: PlacesGovernor | undefined;
  let placesStats: PlacesStatsRecorder | undefined;
  let contributionsRepo: MasjidContributionsRepo | undefined;
  let communityRefresh: CommunityRefreshJob | undefined;
  let auditRepo: AdminAuditRepo | undefined;
  let subsRepo: PgSubscriptionsRepo | undefined;
  let pushStatsRepo: PushStatsRepo | undefined;
  let appSettings: AppSettingsRepo | undefined;
  let telemetryRepo: TelemetryRepo | undefined;
  let placesUsageRepo: ReturnType<typeof createPlacesUsageRepo> | undefined;
  let retention: RetentionJob | undefined;
  let getDbStatus = async (): Promise<DbStatus> => "disabled";

  if (config.dbEnabled && config.databaseUrl) {
    try {
      pool = await createPool(config.databaseUrl);
      await initDb(pool);
      getDbStatus = async () => dbHealth(pool!);

      subsRepo = new PgSubscriptionsRepo(pool);
      const logRepo = new PgPushLogRepo(pool);
      const alertRulesRepo = new PgAlertRulesRepo(pool);
      // Durable delivery rollup — push_log is pruned at 48h and cannot back a
      // history chart (docs/ADMIN_DASHBOARD.md).
      pushStatsRepo = createPushStatsRepo(pool);

      // Durable 30-day masjid cell cache — survives deploys, so a redeploy no
      // longer re-buys every cell from Google (ADR-014).
      placesCacheRepo = createPlacesCacheRepo(pool);
      cachePrune = startCachePrune(placesCacheRepo);

      // Spend governor + anonymous request telemetry. Both are DB-backed, so a
      // stateless boot simply runs without them (burst breaker only).
      const usageRepo = createPlacesUsageRepo(pool);
      placesUsageRepo = usageRepo;
      placesGovernor = createPlacesGovernor(usageRepo, {
        monthlyCap: config.placesMonthlyUnitCap,
      });
      placesStats = createPlacesStatsRecorder(pool);
      placesStats.start();

      // User-contributed masjids: stored here, folded into the resident index
      // once a moderator approves them.
      contributionsRepo = createMasjidContributionsRepo(pool);
      communityRefresh = startCommunityRefresh(contributionsRepo, residentMasjids);

      // Audit trail for the admin dashboard. Optional like everything else here:
      // without a DB the dashboard still serves its read-only views.
      auditRepo = createAdminAuditRepo(pool);

      // Runtime overrides (Places kill-switch + spend cap). Read on the request
      // path through a 30s cache; every reader falls back to the env value.
      telemetryRepo = createTelemetryRepo(pool);
      appSettings = createAppSettings(pool);
      const storedCap = await appSettings.get<number | null>(
        SETTING_KEYS.placesMonthlyUnitCap,
        null,
      );
      if (typeof storedCap === "number" && placesGovernor) {
        // Honour a dashboard change across restarts.
        placesGovernor.setMonthlyCap(storedCap);
        log.info("Applied stored Places monthly cap", { cap: storedCap });
      }

      featureRouters.push(
        createPushRouter({
          subsRepo,
          alertRulesRepo,
          vapidPublicKey: config.vapid?.publicKey ?? null,
          pushEnabled: config.pushEnabled,
        }),
      );

      if (config.pushEnabled && config.vapid) {
        setupWebPush(config.vapid);
        scheduler = new PrayerScheduler({
          subsRepo,
          alertRulesRepo,
          logRepo,
          statsRepo: pushStatsRepo,
        });
        scheduler.start();
        log.info("Web-push scheduler started");
      } else {
        log.warn("Push routes mounted but sending disabled (no VAPID)");
      }
    } catch (err) {
      getDbStatus = async (): Promise<DbStatus> => "down";
      log.error("Database/push init failed — continuing in stateless mode", err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Mounted last so it can take the cache repo when the DB came up; always
  // mounted, and without a key the route itself reports { enabled: false }.
  featureRouters.push(
    createPlacesRouter({
      apiKey: config.googleMapsApiKey,
      embedKey: config.googleMapsEmbedKey,
      cacheRepo: placesCacheRepo,
      resident: residentMasjids,
      governor: placesGovernor,
      stats: placesStats,
      contributions: contributionsRepo,
      adminToken: config.adminToken,
      // Kill-switches. Both default to ON when the store is unreadable.
      isEnabled: () =>
        appSettings?.get(SETTING_KEYS.placesEnabled, true) ?? Promise.resolve(true),
      isTravelEnabled: () =>
        appSettings?.get(SETTING_KEYS.placesTravelEnabled, true) ?? Promise.resolve(true),
    }),
  );

  // Anonymous audience ping (ADR-016). Always mounted: it answers 204
  // regardless, so its behaviour never depends on what came up at boot.
  featureRouters.push(
    createTelemetryRouter({
      repo: telemetryRepo,
      cities: citiesIndex,
      salt: config.telemetrySalt,
      precisionDeg: config.telemetryPrecisionDeg,
      isEnabled: () =>
        appSettings?.get(SETTING_KEYS.telemetryEnabled, true) ?? Promise.resolve(true),
    }),
  );

  // One daily sweep for every retention policy, so the privacy policy's
  // promises are kept by code. Also finally schedules places_usage.prune(),
  // which has existed since ADR-014 with nothing calling it.
  if (pool) {
    retention = startRetention({
      telemetry: telemetryRepo,
      telemetryRetentionDays: config.telemetryRetentionDays,
      audit: auditRepo,
      pushStats: pushStatsRepo,
      placesUsage: placesUsageRepo,
    });
  }

  // Values the log ring buffer must scrub if they ever appear in a message.
  // Registered here because logger.ts cannot import config.ts.
  registerRedactedSecrets([
    config.databaseUrl,
    config.vapid?.privateKey,
    config.googleMapsApiKey,
    config.googleMapsEmbedKey,
    config.telemetrySalt,
    config.adminSessionSecret,
    config.adminPasswordHash,
    config.adminToken,
  ]);

  // Operator dashboard. Built only when a password hash is configured, so an
  // unconfigured deploy exposes nothing (and doesn't advertise the surface).
  const adminRouter = config.adminEnabled
    ? createAdminRouter({
        session: {
          passwordHash: config.adminPasswordHash!,
          sessionSecret: config.adminSessionSecret,
          // Browsers refuse Secure cookies over http://localhost, which would
          // make the dashboard impossible to log into in local development.
          secureCookies: config.isProduction,
        },
        audit: auditRepo,
        contributions: contributionsRepo,
        // Approvals take effect immediately instead of waiting for the poll.
        refreshCommunity: communityRefresh?.refreshNow,
        subsRepo,
        getSchedulerStats: scheduler ? () => scheduler!.stats() : undefined,
        settings: appSettings,
        settingsDefaults: {
          placesEnabled: config.placesEnabled,
          placesTravelEnabled: true,
          placesMonthlyUnitCap: config.placesMonthlyUnitCap,
          telemetryEnabled: config.telemetryEnabled,
        },
        applyMonthlyCap: (cap) => placesGovernor?.setMonthlyCap(cap),
        telemetryConfigured: config.telemetryEnabled,
        precisionDeg: config.telemetryPrecisionDeg,
        retentionDays: config.telemetryRetentionDays,
        serverVersion: SERVER_VERSION,
        startedAt: Date.now(),
        env: config.nodeEnv,
        getDbStatus,
        pool,
        governor: placesGovernor,
        resident: residentMasjids,
        embedKey: config.googleMapsEmbedKey,
        monthlyCap: config.placesMonthlyUnitCap,
        flags: {
          placesEnabled: config.placesEnabled,
          pushEnabled: config.pushEnabled,
          telemetryEnabled: config.telemetryEnabled,
        },
      })
    : undefined;

  const router = createRouter({ getDbStatus, featureRouters });
  const staticDir = path.resolve(__dirname, "..", "static");
  const adminDir = path.resolve(__dirname, "..", "static-admin");
  const app = createApp({ router, staticDir, adminDir, adminRouter });

  const server = app.listen(config.port, () => {
    log.info(`Prayer server listening on http://localhost:${config.port} (env=${config.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    log.info(`Received ${signal}, shutting down...`);
    scheduler?.stop();
    cachePrune?.stop();
    communityRefresh?.stop();
    retention?.stop();
    placesStats?.stop(); // flushes the buffered counters on the way out
    server.close(() => {
      const done = () => {
        log.info("Shutdown complete");
        process.exit(0);
      };
      if (pool) pool.end().then(done).catch(done);
      else done();
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.error("Fatal startup error", err instanceof Error ? err : new Error(String(err)));
  process.exit(1);
});
