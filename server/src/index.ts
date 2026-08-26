import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Router } from "express";
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

/** How often to retry DB bring-up after a failed startup (forever, unref'd). */
const DB_RETRY_INTERVAL_MS = 60_000;

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

/** The DB-backed halves of the places router — absent while the DB is down. */
interface PlacesDbDeps {
  cacheRepo?: PlacesCacheRepo;
  governor?: PlacesGovernor;
  stats?: PlacesStatsRecorder;
  contributions?: MasjidContributionsRepo;
}

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
  // Everything the DB brings up is held in these mutable refs so a LATER bring-up
  // (see initDbDependent + the retry loop) can populate them without a restart,
  // and the shutdown handler can stop whatever ended up running.
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
  // Wire the DB features exactly once (dbUp), and never let a slow retry overlap
  // itself (dbInitInFlight). dbRetryTimer is the forever-retry loop's handle.
  let dbUp = false;
  let dbInitInFlight = false;
  let dbRetryTimer: ReturnType<typeof setInterval> | null = null;

  // Live DB status for /api/health and the admin overview. Reads the mutable
  // `pool` so a later bring-up (or loss) is reflected without rebuilding the
  // closure: "disabled" when there is no DB by config, "down" while configured
  // but not (yet) connected, else the real connectivity probe.
  const getDbStatus = async (): Promise<DbStatus> => {
    if (!config.dbEnabled || !config.databaseUrl) return "disabled";
    if (!pool) return "down";
    return dbHealth(pool);
  };

  const dbIntended = Boolean(config.dbEnabled && config.databaseUrl);

  // Router builders. Called both for the stateless boot and — with the DB deps —
  // once the pool is up, so a bring-up simply rebuilds and swaps them in.
  const buildTelemetryRouter = (repo: TelemetryRepo | undefined): Router =>
    createTelemetryRouter({
      repo,
      cities: citiesIndex,
      salt: config.telemetrySalt,
      precisionDeg: config.telemetryPrecisionDeg,
      isEnabled: () =>
        appSettings?.get(SETTING_KEYS.telemetryEnabled, true) ?? Promise.resolve(true),
    });

  const buildPlacesRouter = (db: PlacesDbDeps = {}): Router =>
    createPlacesRouter({
      apiKey: config.googleMapsApiKey,
      embedKey: config.googleMapsEmbedKey,
      cacheRepo: db.cacheRepo,
      resident: residentMasjids,
      governor: db.governor,
      stats: db.stats,
      contributions: db.contributions,
      adminToken: config.adminToken,
      // On a DB-backed deploy a missing governor means the pool is down, so fail
      // closed to resident-only (zero Google spend) rather than let the burst
      // breaker be the sole bound (task 6 / docs/QIBLA_MASJID_SPEC.md §6d).
      requireGovernor: dbIntended,
      // Kill-switches. Both default to ON when the store is unreadable.
      isEnabled: () =>
        appSettings?.get(SETTING_KEYS.placesEnabled, true) ?? Promise.resolve(true),
      isTravelEnabled: () =>
        appSettings?.get(SETTING_KEYS.placesTravelEnabled, true) ?? Promise.resolve(true),
    });

  // Late-bindable mount for the DB-dependent feature routers. It is placed in the
  // chain now with a STATELESS delegate — places (resident-only; fails closed
  // without a governor) and telemetry (204s without persisting) still answer
  // while the DB is down; push has no stateless mode, so it appears only once the
  // DB comes up. On bring-up the delegate is swapped for the DB-backed build.
  let dbFeatureRouter: Router = ((): Router => {
    const r = Router();
    r.use(buildPlacesRouter());
    r.use(buildTelemetryRouter(undefined));
    return r;
  })();
  const dbFeatureMount = Router();
  dbFeatureMount.use((req, res, next) => dbFeatureRouter(req, res, next));
  featureRouters.push(dbFeatureMount);

  /**
   * Bring up everything that needs the database, exactly once. Shared by the
   * startup path and the retry loop. ALL fallible work (the pool, the schema,
   * the stored-cap read, and VAPID validation, since setupWebPush throws
   * synchronously on a bad key) happens before any shared ref is published, the
   * feature router swapped, or a background timer started. So a throw leaves nothing
   * published or running and a retry starts from a clean slate (rather than a
   * half-live system whose timers the retry would then duplicate).
   */
  async function initDbDependent(): Promise<void> {
    if (dbUp || dbInitInFlight) return;
    dbInitInFlight = true;
    let p: Pool | undefined;
    try {
      p = await createPool(config.databaseUrl!);
      await initDb(p);

      const newSubsRepo = new PgSubscriptionsRepo(p);
      const logRepo = new PgPushLogRepo(p);
      const alertRulesRepo = new PgAlertRulesRepo(p);
      // Durable delivery rollup — push_log is pruned at 48h and cannot back a
      // history chart (docs/ADMIN_DASHBOARD.md).
      const newPushStatsRepo = createPushStatsRepo(p);
      // Durable 30-day masjid cell cache — survives deploys, so a redeploy no
      // longer re-buys every cell from Google (ADR-014).
      const newPlacesCacheRepo = createPlacesCacheRepo(p);
      // Spend governor + anonymous request telemetry.
      const usageRepo = createPlacesUsageRepo(p);
      const newGovernor = createPlacesGovernor(usageRepo, {
        monthlyCap: config.placesMonthlyUnitCap,
      });
      const newPlacesStats = createPlacesStatsRecorder(p);
      // User-contributed masjids: stored here, folded into the resident index
      // once a moderator approves them.
      const newContributionsRepo = createMasjidContributionsRepo(p);
      // Audit trail for the admin dashboard.
      const newAuditRepo = createAdminAuditRepo(p);
      // Runtime overrides (Places kill-switch + spend cap).
      const newTelemetryRepo = createTelemetryRepo(p);
      const newAppSettings = createAppSettings(p);
      const storedCap = await newAppSettings.get<number | null>(
        SETTING_KEYS.placesMonthlyUnitCap,
        null,
      );
      if (typeof storedCap === "number") {
        // Honour a dashboard change across restarts.
        newGovernor.setMonthlyCap(storedCap);
        log.info("Applied stored Places monthly cap", { cap: storedCap });
      }

      // Validate VAPID and construct the scheduler HERE, while a throw is still
      // safe: setupWebPush() validates the keys and throws SYNCHRONOUSLY on a
      // malformed one. It must run before anything is published or any timer is
      // started, otherwise a bad key would throw with the shared refs already
      // live and the cache/stats/community timers already running, and each 60s
      // retry (which re-enters this function) would start duplicates. The
      // scheduler is only constructed now; it is started in the side-effect phase
      // below. Absent VAPID keeps the existing warn-and-continue behaviour.
      let newScheduler: PrayerScheduler | undefined;
      if (config.pushEnabled && config.vapid) {
        setupWebPush(config.vapid);
        newScheduler = new PrayerScheduler({
          subsRepo: newSubsRepo,
          alertRulesRepo,
          logRepo,
          statsRepo: newPushStatsRepo,
        });
      } else {
        log.warn("Push routes mounted but sending disabled (no VAPID)");
      }

      // Build the DB-backed feature router (construction only, no side effects):
      // adds push, gives places its governor/cache/stats, and persists telemetry.
      const dbRouter = Router();
      dbRouter.use(
        createPushRouter({
          subsRepo: newSubsRepo,
          alertRulesRepo,
          vapidPublicKey: config.vapid?.publicKey ?? null,
          pushEnabled: config.pushEnabled,
        }),
      );
      dbRouter.use(
        buildPlacesRouter({
          cacheRepo: newPlacesCacheRepo,
          governor: newGovernor,
          stats: newPlacesStats,
          contributions: newContributionsRepo,
        }),
      );
      dbRouter.use(buildTelemetryRouter(newTelemetryRepo));

      // ── Side-effect phase. Everything fallible is done; nothing below throws.
      // Publish the shared refs (admin router + shutdown read these), swap in the
      // router, then start the background timers, so a throw earlier leaves NOTHING
      // published or running and a retry starts from a clean slate. ──
      pool = p;
      subsRepo = newSubsRepo;
      pushStatsRepo = newPushStatsRepo;
      placesCacheRepo = newPlacesCacheRepo;
      placesUsageRepo = usageRepo;
      placesGovernor = newGovernor;
      placesStats = newPlacesStats;
      contributionsRepo = newContributionsRepo;
      auditRepo = newAuditRepo;
      telemetryRepo = newTelemetryRepo;
      appSettings = newAppSettings;
      scheduler = newScheduler;
      dbFeatureRouter = dbRouter;

      cachePrune = startCachePrune(newPlacesCacheRepo);
      newPlacesStats.start();
      communityRefresh = startCommunityRefresh(newContributionsRepo, residentMasjids);
      if (newScheduler) {
        newScheduler.start();
        log.info("Web-push scheduler started");
      }

      // One daily sweep for every retention policy, so the privacy policy's
      // promises are kept by code. Also schedules the pruners that had existed
      // with nothing calling them (places_usage since ADR-014) and the two this
      // batch adds: ruleless subscriptions and places_cell_demand.
      retention = startRetention({
        telemetry: newTelemetryRepo,
        telemetryRetentionDays: config.telemetryRetentionDays,
        audit: newAuditRepo,
        pushStats: newPushStatsRepo,
        placesUsage: usageRepo,
        subscriptions: newSubsRepo,
        cellDemand: newPlacesStats,
      });

      dbUp = true;
      log.info("Database-dependent features initialized");
    } catch (err) {
      // Roll back a half-open pool so a retry neither leaks it nor reports "up".
      if (p) {
        await p.end().catch(() => undefined);
        if (pool === p) pool = undefined;
      }
      throw err;
    } finally {
      dbInitInFlight = false;
    }
  }

  /** After a failed startup, retry the DB bring-up forever until it succeeds. */
  function scheduleDbRetry(): void {
    if (dbRetryTimer || dbUp) return;
    dbRetryTimer = setInterval(() => {
      void initDbDependent()
        .then(() => {
          if (dbUp && dbRetryTimer) {
            clearInterval(dbRetryTimer);
            dbRetryTimer = null;
            log.info("Database came up on retry — stateful features enabled");
          }
        })
        .catch((err) => {
          log.warn(
            "Database still unavailable; will keep retrying",
            err instanceof Error ? err : new Error(String(err)),
          );
        });
    }, DB_RETRY_INTERVAL_MS);
    dbRetryTimer.unref();
  }

  if (dbIntended) {
    try {
      await initDbDependent();
    } catch (err) {
      log.error(
        "Database/push init failed — continuing in stateless mode; will retry",
        err instanceof Error ? err : new Error(String(err)),
      );
      scheduleDbRetry();
    }
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
  // Built after the startup DB attempt so a normal boot gives it live repos;
  // when the DB was down at boot and only comes up on a later retry, its
  // getDbStatus still reflects that (it reads the mutable pool), but its data
  // views stay degraded until the next restart.
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
    if (dbRetryTimer) clearInterval(dbRetryTimer);
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
