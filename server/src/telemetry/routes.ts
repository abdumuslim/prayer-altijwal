import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { childLogger } from "../logger.js";
import type { CitiesIndex } from "../geo/cities-index.js";
import type { TelemetryRepo } from "../db/repositories/telemetry.js";
import { clientIdOf, clientIpOf, ipPrefix } from "../places/identity.js";
import { dauHash, quantize } from "./hash.js";

const log = childLogger("telemetry");

/** Generous for one ping a day; tight enough that nobody can flood the table. */
const MAX_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const MAX_TRACKED_IPS = 5000;

/**
 * Strict whitelists everywhere — the endpoint is public, so nothing here is a
 * free-text field that could be turned into storage.
 */
const PingBody = z.object({
  platform: z.enum(["web", "android", "ios"]),
  appVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locSource: z.enum(["default", "gps", "search", "governorate"]).optional(),
  tz: z.string().max(50).optional(),
  features: z.array(z.enum(["duha", "qiyam", "rawatib", "adhkar", "record"])).max(5).optional(),
  notif: z.boolean().optional(),
  theme: z.enum(["night", "glass", "material", "contrast"]).optional(),
  displayMode: z.enum(["standalone", "browser", "native"]).optional(),
});

export interface TelemetryRouterDeps {
  readonly repo?: TelemetryRepo;
  readonly cities?: CitiesIndex;
  readonly salt?: string;
  /** Server-side clamp; the client already rounds before sending. */
  readonly precisionDeg: number;
  /** Runtime switch from the admin dashboard. Absent ⇒ enabled. */
  readonly isEnabled?: () => Promise<boolean>;
}

/**
 * POST /api/telemetry/ping — the anonymous daily audience ping (ADR-016).
 *
 * ALWAYS answers 204: disabled, malformed, rate-limited, or database down. The
 * client treats any failure as "try again tomorrow", and an endpoint that can
 * report server state is an endpoint that can be probed.
 *
 * Mounted unconditionally (the createPlacesRouter pattern) so its behaviour
 * doesn't depend on boot order.
 */
export function createTelemetryRouter(deps: TelemetryRouterDeps): Router {
  const r = Router();
  const seen = new Map<string, { count: number; windowStart: number }>();

  function allow(key: string, now: number): boolean {
    const entry = seen.get(key);
    if (!entry || now - entry.windowStart > HOUR_MS) {
      seen.set(key, { count: 1, windowStart: now });
      if (seen.size > MAX_TRACKED_IPS) {
        // Insertion order is roughly age order; drop the oldest.
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return true;
    }
    entry.count += 1;
    return entry.count <= MAX_PER_HOUR;
  }

  r.post("/api/telemetry/ping", async (req: Request, res: Response) => {
    // Answer first, work afterwards: nothing about the outcome is observable.
    res.status(204).end();

    try {
      if (!deps.repo || !deps.salt) return;
      if (deps.isEnabled && !(await deps.isEnabled())) return;

      const ipKey = ipPrefix(clientIpOf(req));
      if (!allow(ipKey, Date.now())) return;

      const parsed = PingBody.safeParse(req.body);
      if (!parsed.success) return;
      const body = parsed.data;

      // Re-clamp precision: a modified client cannot store anything finer.
      const lat = body.lat === undefined ? null : quantize(body.lat, deps.precisionDeg);
      const lon = body.lon === undefined ? null : quantize(body.lon, deps.precisionDeg);

      // Place names are DERIVED here, never sent — one less field on the wire.
      let country: string | null = null;
      let city: string | null = null;
      if (lat !== null && lon !== null && deps.cities) {
        const nearest = deps.cities.reverse(lat, lon);
        if (nearest) {
          country = nearest.cc ?? null;
          // ASCII transliteration: the dashboard is English, and it groups
          // cleanly without mixing scripts in a chart axis.
          city = nearest.a || nearest.n || null;
        }
      }

      // The server's UTC day, matching what every query groups by.
      const day = new Date().toISOString().slice(0, 10);
      const clientId = clientIdOf(req, ipKey);

      await deps.repo.record({
        day,
        dauHash: dauHash(deps.salt, day, clientId),
        platform: body.platform,
        appVersion: body.appVersion ?? null,
        lat,
        lon,
        locPrecision: deps.precisionDeg,
        locSource: body.locSource ?? null,
        country,
        city,
        tz: body.tz ?? null,
        features: body.features ?? [],
        notif: body.notif ?? false,
        theme: body.theme ?? null,
        displayMode: body.displayMode ?? null,
      });
    } catch (err) {
      log.warn("ping handling failed", err instanceof Error ? err : new Error(String(err)));
    }
  });

  return r;
}
