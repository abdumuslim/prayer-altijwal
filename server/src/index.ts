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
import { createPool, dbHealth } from "./db/pool.js";
import { initDb } from "./db/schema.js";
import { PgSubscriptionsRepo } from "./db/repositories/subscriptions.js";
import { PgPushLogRepo } from "./db/repositories/push-log.js";
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

  const featureRouters = [createPrayerRouter(), createGeoRouter(citiesIndex)];

  // DB + push are optional. Degrade to stateless (public prayer-times still
  // works) rather than crash-looping if the SHARED Postgres is briefly down.
  let pool: Pool | undefined;
  let scheduler: PrayerScheduler | undefined;
  let getDbStatus = async (): Promise<DbStatus> => "disabled";

  if (config.dbEnabled && config.databaseUrl) {
    try {
      pool = await createPool(config.databaseUrl);
      await initDb(pool);
      getDbStatus = async () => dbHealth(pool!);

      const subsRepo = new PgSubscriptionsRepo(pool);
      const logRepo = new PgPushLogRepo(pool);

      featureRouters.push(
        createPushRouter({
          subsRepo,
          vapidPublicKey: config.vapid?.publicKey ?? null,
          pushEnabled: config.pushEnabled,
        }),
      );

      if (config.pushEnabled && config.vapid) {
        setupWebPush(config.vapid);
        scheduler = new PrayerScheduler({ subsRepo, logRepo });
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

  const router = createRouter({ getDbStatus, featureRouters });
  const staticDir = path.resolve(__dirname, "..", "static");
  const app = createApp(router, staticDir);

  const server = app.listen(config.port, () => {
    log.info(`Prayer server listening on http://localhost:${config.port} (env=${config.nodeEnv})`);
  });

  const shutdown = (signal: string): void => {
    log.info(`Received ${signal}, shutting down...`);
    scheduler?.stop();
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
