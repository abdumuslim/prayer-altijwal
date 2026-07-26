import "dotenv/config";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { childLogger } from "./logger.js";

const log = childLogger("config");

// Boundary validation for process env (hard rule 9: validate at boundaries,
// fail fast at startup). Secrets are optional at the schema level so the public,
// stateless surface (prayer-times + geo) can run locally without a DB or VAPID;
// they become REQUIRED in production via the refinement below.
const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(8000),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().url().optional(),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default("mailto:admin@altijwal.com"),
  // Comma-separated allowlist for CORS; empty = same-origin only (default).
  CORS_ORIGINS: z.string().optional(),
  // Google Places API (New) key for the nearest-masjid proxy. OPTIONAL even in
  // production: absent ⇒ /api/places/masjids reports { enabled: false } and the
  // client hides the section (docs/QIBLA_MASJID_SPEC.md Q2) — never a startup failure.
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
  // Maps EMBED API key — a SECOND, browser-visible key sent to the client so an
  // expanded masjid row can render an interactive directions map. It must be
  // restricted to the Embed API (free/unmetered) in GCP; never point this at the
  // Places key. Absent ⇒ rows expand with the deep-link buttons only.
  GOOGLE_MAPS_EMBED_KEY: z.string().min(1).optional(),
  // Self-imposed monthly ceiling on PAID upstream work, counted in UNITS: a live
  // masjid search costs 1 (= 1 Places call) and an on-expand travel lookup costs
  // 2 (= 2 Routes elements). Because a unit is never cheaper than the SKU it
  // buys, one cap bounds BOTH free tiers at once: at 4500 units we can consume
  // at most 4500 Places calls (free tier 5000) and at most 4500 Routes elements
  // (free tier 10000), whatever the mix. Kept below both for headroom.
  PLACES_MONTHLY_UNIT_CAP: z.coerce.number().int().nonnegative().default(4500),
  // Guards GET /api/places/usage. Absent ⇒ that route 404s.
  ADMIN_TOKEN: z.string().min(16).optional(),
  // ── Admin dashboard (/admin) ────────────────────────────────────────────
  // scrypt digest of the operator password, produced by
  // `node scripts/hash-admin-password.mjs` (format scrypt:N:r:p:salt:hash —
  // ':' not '$', because Docker Compose interpolates '$' inside env_file values).
  // Absent ⇒ the whole /api/admin tree 404s and the dashboard cannot be used
  // (same "don't advertise the endpoint" posture as ADMIN_TOKEN above).
  ADMIN_PASSWORD_HASH: z.string().min(20).optional(),
  // HMAC key for the session cookie. Absent ⇒ a random one is generated per
  // boot, which silently logs the operator out on every restart/redeploy.
  ADMIN_SESSION_SECRET: z.string().min(32).optional(),
  // ── Anonymous audience telemetry (ADR-016) ─────────────────────────────
  // HMAC key for the DAILY-ROTATING install hash. Absent ⇒ the ping no-ops.
  // Rotating this key makes all previously stored days mutually unlinkable —
  // which is the point: nothing stored can follow an install across days.
  TELEMETRY_SALT: z.string().min(16).optional(),
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  // Grid precision the SERVER will store, in degrees. 0.01 ≈ 1.1 km. This is a
  // defence-in-depth clamp: the client already rounds before sending, so a
  // modified client cannot cause finer data to be stored. LOWERING THIS IS A
  // PRIVACY-POLICY + PLAY DATA-SAFETY CHANGE, not a config tweak.
  TELEMETRY_PRECISION_DEG: z.coerce.number().min(0).max(1).default(0.01),
  // ── Play Console stats (optional, admin dashboard only) ────────────────
  // Path to a Google service-account JSON, bind-mounted at runtime — never in
  // the image, never in the tarball. Absent ⇒ the Play page reports "not configured".
  PLAY_SA_KEY_FILE: z.string().min(1).optional(),
  PLAY_PACKAGE_NAME: z.string().min(1).default("com.altijwal.prayer"),
  // gs:// bucket holding the Play bulk reports (installs/ratings live only there,
  // not in the Reporting API). From Play Console → Download reports.
  PLAY_REPORTS_BUCKET: z.string().min(1).optional(),
});

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface Config {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  logLevel: string;
  databaseUrl: string | undefined;
  vapid: VapidConfig | undefined;
  corsOrigins: string[];
  /** DB-backed features (push storage + scheduler) are available. */
  dbEnabled: boolean;
  /** Web-push sending is configured (VAPID present). */
  pushEnabled: boolean;
  /** Google Places proxy (nearest masjid) is configured. */
  placesEnabled: boolean;
  googleMapsApiKey: string | undefined;
  /** Browser-visible Embed-API key (see EnvSchema) — never the Places key. */
  googleMapsEmbedKey: string | undefined;
  /** Monthly ceiling on paid upstream units (see EnvSchema). */
  placesMonthlyUnitCap: number;
  /** Token gating GET /api/places/usage; absent ⇒ the route 404s. */
  adminToken: string | undefined;
  /** The /admin dashboard is configured (a password hash is present). */
  adminEnabled: boolean;
  adminPasswordHash: string | undefined;
  /** HMAC key for admin session cookies; random per boot when unset. */
  adminSessionSecret: string;
  /** True when the session secret was generated rather than configured. */
  adminSessionSecretEphemeral: boolean;
  /** Anonymous audience ping can be stored (salt present AND a DB exists). */
  telemetryEnabled: boolean;
  telemetrySalt: string | undefined;
  telemetryRetentionDays: number;
  /** Coarsest-wins clamp on stored ping coordinates, in degrees. */
  telemetryPrecisionDeg: number;
  playSaKeyFile: string | undefined;
  playPackageName: string;
  playReportsBucket: string | undefined;
}

function load(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    log.error("Invalid environment configuration", { fields });
    throw new Error(`Invalid environment configuration: ${JSON.stringify(fields)}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === "production";

  const hasVapid = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

  // Fail fast: in production the deploy MUST carry the DB + push secrets.
  if (isProduction) {
    const missing: string[] = [];
    if (!env.DATABASE_URL) missing.push("DATABASE_URL");
    if (!env.VAPID_PUBLIC_KEY) missing.push("VAPID_PUBLIC_KEY");
    if (!env.VAPID_PRIVATE_KEY) missing.push("VAPID_PRIVATE_KEY");
    if (missing.length > 0) {
      const msg = `Missing required production secrets: ${missing.join(", ")}`;
      log.error(msg);
      throw new Error(msg);
    }
  }

  const vapid: VapidConfig | undefined = hasVapid
    ? {
        publicKey: env.VAPID_PUBLIC_KEY as string,
        privateKey: env.VAPID_PRIVATE_KEY as string,
        subject: env.VAPID_SUBJECT,
      }
    : undefined;

  const corsOrigins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!env.DATABASE_URL) {
    log.warn("DATABASE_URL not set — push storage + scheduler disabled (stateless mode)");
  }
  if (!hasVapid) {
    log.warn("VAPID keys not set — web-push disabled");
  }
  if (!env.GOOGLE_MAPS_API_KEY) {
    log.warn("GOOGLE_MAPS_API_KEY not set — nearest-masjid places proxy disabled");
  }
  if (env.GOOGLE_MAPS_API_KEY && !env.GOOGLE_MAPS_EMBED_KEY) {
    log.warn("GOOGLE_MAPS_EMBED_KEY not set — masjid rows expand without the map");
  }

  // The admin dashboard is opt-in: no password hash ⇒ /api/admin never mounts.
  const adminEnabled = Boolean(env.ADMIN_PASSWORD_HASH);
  if (!adminEnabled) {
    log.warn("ADMIN_PASSWORD_HASH not set — /admin dashboard API disabled (404)");
  }
  // A per-boot secret still works, it just invalidates sessions on restart.
  const adminSessionSecretEphemeral = !env.ADMIN_SESSION_SECRET;
  if (adminEnabled && adminSessionSecretEphemeral) {
    log.warn("ADMIN_SESSION_SECRET not set — using a per-boot key; admin sessions drop on restart");
  }
  const adminSessionSecret = env.ADMIN_SESSION_SECRET ?? randomBytes(32).toString("base64url");

  const telemetryEnabled = Boolean(env.TELEMETRY_SALT) && Boolean(env.DATABASE_URL);
  if (!env.TELEMETRY_SALT) {
    log.warn("TELEMETRY_SALT not set — anonymous audience ping disabled (endpoint still 204s)");
  }

  return {
    nodeEnv: env.NODE_ENV,
    isProduction,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    vapid,
    corsOrigins,
    dbEnabled: Boolean(env.DATABASE_URL),
    pushEnabled: Boolean(env.DATABASE_URL) && hasVapid,
    placesEnabled: Boolean(env.GOOGLE_MAPS_API_KEY),
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY,
    googleMapsEmbedKey: env.GOOGLE_MAPS_EMBED_KEY,
    placesMonthlyUnitCap: env.PLACES_MONTHLY_UNIT_CAP,
    adminToken: env.ADMIN_TOKEN,
    adminEnabled,
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    adminSessionSecret,
    adminSessionSecretEphemeral,
    telemetryEnabled,
    telemetrySalt: env.TELEMETRY_SALT,
    telemetryRetentionDays: env.TELEMETRY_RETENTION_DAYS,
    telemetryPrecisionDeg: env.TELEMETRY_PRECISION_DEG,
    playSaKeyFile: env.PLAY_SA_KEY_FILE,
    playPackageName: env.PLAY_PACKAGE_NAME,
    playReportsBucket: env.PLAY_REPORTS_BUCKET,
  };
}

export const config: Config = load();
