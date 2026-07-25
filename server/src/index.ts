import path from "node:path";
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

const log = childLogger("index");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  let getDbStatus = async (): Promise<DbStatus> => "disabled";

  if (config.dbEnabled && config.databaseUrl) {
    try {
      pool = await createPool(config.databaseUrl);
      await initDb(pool);
      getDbStatus = async () => dbHealth(pool!);

      const subsRepo = new PgSubscriptionsRepo(pool);
      const logRepo = new PgPushLogRepo(pool);
      const alertRulesRepo = new PgAlertRulesRepo(pool);

      // Durable 30-day masjid cell cache — survives deploys, so a redeploy no
      // longer re-buys every cell from Google (ADR-014).
      placesCacheRepo = createPlacesCacheRepo(pool);
      cachePrune = startCachePrune(placesCacheRepo);

      // Spend governor + anonymous request telemetry. Both are DB-backed, so a
      // stateless boot simply runs without them (burst breaker only).
      const usageRepo = createPlacesUsageRepo(pool);
      placesGovernor = createPlacesGovernor(usageRepo, {
        monthlyCap: config.placesMonthlyUnitCap,
      });
      placesStats = createPlacesStatsRecorder(pool);
      placesStats.start();

      // User-contributed masjids: stored here, folded into the resident index
      // once a moderator approves them.
      contributionsRepo = createMasjidContributionsRepo(pool);
      communityRefresh = startCommunityRefresh(contributionsRepo, residentMasjids);

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
        scheduler = new PrayerScheduler({ subsRepo, alertRulesRepo, logRepo });
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
    }),
  );

  const router = createRouter({ getDbStatus, featureRouters });
  const staticDir = path.resolve(__dirname, "..", "static");
  const app = createApp(router, staticDir);

  const server = app.listen(config.port, () => {
    log.info(`Prayer server listening on http://localhost:${config.port} (env=${config.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    log.info(`Received ${signal}, shutting down...`);
    scheduler?.stop();
    cachePrune?.stop();
    communityRefresh?.stop();
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
