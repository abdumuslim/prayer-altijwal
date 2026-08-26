import pg from "pg";
import { childLogger } from "../logger.js";
import { config } from "../config.js";

const log = childLogger("db/pool");

const APP_DB = "prayer";

/**
 * Derive the bootstrap connection string that targets the cluster's default
 * `postgres` database from the app's `DATABASE_URL` (which targets `prayer`).
 * We only swap the path component so credentials/host/port/query are preserved.
 */
function bootstrapUrl(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    u.pathname = "/postgres";
    return u.toString();
  } catch {
    // Fall back to the original URL if it is not a parseable URL; the bootstrap
    // client will then connect to whatever DB the string names.
    return databaseUrl;
  }
}

/**
 * Create the application pool, bootstrapping the dedicated `prayer` database if
 * it is absent. VPS-SAFETY: this shares a Postgres cluster with other apps — we
 * ONLY `CREATE DATABASE prayer` when `pg_database` lacks it; we never drop or
 * alter any other database.
 */
export async function createPool(
  databaseUrl: string,
  max: number = config.pgPoolMax,
): Promise<pg.Pool> {
  const bootstrap = new pg.Client({ connectionString: bootstrapUrl(databaseUrl) });
  try {
    await bootstrap.connect();
    const existing = await bootstrap.query("SELECT 1 FROM pg_database WHERE datname = $1", [APP_DB]);
    if (existing.rowCount === 0) {
      // datname cannot be parameterized in CREATE DATABASE; APP_DB is a fixed
      // internal constant (never user input), so this is safe.
      await bootstrap.query(`CREATE DATABASE ${APP_DB}`);
      log.info(`Created database "${APP_DB}"`);
    } else {
      log.info(`Database "${APP_DB}" already present`);
    }
  } catch (error: unknown) {
    log.error("Database bootstrap failed", error instanceof Error ? error : { error });
    throw error;
  } finally {
    await bootstrap.end().catch(() => undefined);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, min: 1, max });
  log.info("Connection pool created", { min: 1, max });
  return pool;
}

/** Lightweight liveness probe for the health endpoint. */
export async function dbHealth(pool: pg.Pool): Promise<"up" | "down"> {
  try {
    await pool.query("SELECT 1");
    return "up";
  } catch (error: unknown) {
    log.error("Database health check failed", error instanceof Error ? error : { error });
    return "down";
  }
}
