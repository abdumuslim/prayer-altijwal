import "dotenv/config";
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
  };
}

export const config: Config = load();
