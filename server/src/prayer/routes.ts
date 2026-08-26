import { Router, type Request, type Response } from "express";
import type { AsrMadhab, MethodName } from "../prayer-engine/index.js";
import { MonthQuery, PrayerTimesQuery } from "../validation/prayer-times.js";
import { describeMethod, detectMethod } from "./method-detect.js";
import { buildPrayerTimesPayload } from "./payload.js";
import { buildMonthPayload } from "./month-payload.js";
import { childLogger } from "../logger.js";
import { clientIpOf, ipPrefix } from "../places/identity.js";
import { createSlidingLimiter } from "../http/rate-limit.js";

const log = childLogger("prayer/routes");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
/** The web client fetches this once per load / location change. */
const DAILY_PER_IP_PER_MIN = 60;
const DAILY_GLOBAL_PER_MIN = 2000;
/** Strict: the web client stopped calling /month in July (verified); the route
 *  stays only for compatibility, so a real device never approaches this. */
const MONTH_PER_IP_PER_HOUR = 10;
const MONTH_GLOBAL_PER_HOUR = 500;

/**
 * Edge/browser cache for a SUCCESSFUL payload. app.ts defaults every /api/*
 * response to no-store ahead of routing; a 200 opts back in by setting this
 * right before res.json, so a 400/404/429 never inherits it. Not fully
 * deterministic (the payload carries now-relative fields: `now`, per-prayer
 * isPassed/isNext/countdown, the "soonest" Duha/Qiyam window, and defaults
 * `date` to today-in-tz), but 60s is provably safe: the client re-derives every
 * countdown/passed value each second from the absolute `timestamp`s, so a
 * ≤60s-old body renders identically; 60s also bounds clock-sync (`now`) and
 * window-selection drift to a minute and stops a "today" payload outliving local
 * midnight by more than that.
 */
const PUBLIC_CACHE_CONTROL = "public, max-age=60";

export interface PrayerRouterDeps {
  /** Overridable so the caps can be exercised without flooding a test. */
  dailyLimits?: { perIpPerMinute?: number; globalPerMinute?: number };
  monthLimits?: { perIpPerHour?: number; globalPerHour?: number };
}

/** Resolve method/asr exactly like the daily endpoint (explicit key wins,
    else country auto-detection with the Iraqi nationwide profile). */
function resolveMethod(q: {
  method?: string;
  asr?: AsrMadhab;
  country?: string;
  lat: number;
  lon: number;
}): {
  methodKey: MethodName;
  methodLabel: string;
  asr: AsrMadhab;
  auto: boolean;
  baghdadCalibrated: boolean;
} {
  if (q.method) {
    const methodKey = q.method as MethodName;
    const desc = describeMethod(methodKey);
    return {
      methodKey,
      methodLabel: desc.label,
      asr: q.asr ?? desc.asr,
      auto: false,
      baghdadCalibrated: methodKey === "BaghdadYMA",
    };
  }
  const det = detectMethod(q.country, q.lat, q.lon);
  return {
    methodKey: det.key,
    methodLabel: det.label,
    asr: q.asr ?? det.asr,
    auto: true,
    baghdadCalibrated: det.baghdadCalibrated,
  };
}

export function createPrayerRouter(deps: PrayerRouterDeps = {}): Router {
  const r = Router();

  // Per-IP-prefix + global limiters, same idiom as the push/geo routers.
  const dailyLimiter = createSlidingLimiter({
    windowMs: MINUTE_MS,
    perKey: deps.dailyLimits?.perIpPerMinute ?? DAILY_PER_IP_PER_MIN,
    globalPerWindow: deps.dailyLimits?.globalPerMinute ?? DAILY_GLOBAL_PER_MIN,
    onGlobalTrip: () => log.warn("prayer-times global rate cap reached; requests dropped this minute"),
  });
  const monthLimiter = createSlidingLimiter({
    windowMs: HOUR_MS,
    perKey: deps.monthLimits?.perIpPerHour ?? MONTH_PER_IP_PER_HOUR,
    globalPerWindow: deps.monthLimits?.globalPerHour ?? MONTH_GLOBAL_PER_HOUR,
    onGlobalTrip: () => log.warn("prayer-times/month global rate cap reached; requests dropped this hour"),
  });

  /** Guard a route with a limiter. Responds 429 and returns false when over. */
  function allowed(limiter: ReturnType<typeof createSlidingLimiter>, req: Request, res: Response): boolean {
    if (limiter.allow(ipPrefix(clientIpOf(req)))) return true;
    res.status(429).json({ error: "Too many requests" });
    return false;
  }

  r.get("/api/prayer-times", (req: Request, res: Response) => {
    if (!allowed(dailyLimiter, req, res)) return;
    const parsed = PrayerTimesQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const q = parsed.data;
    const m = resolveMethod(q);

    const payload = buildPrayerTimesPayload({
      lat: q.lat,
      lon: q.lon,
      elevation: q.elevation,
      tz: q.tz,
      lang: q.lang,
      method: m.methodKey,
      methodLabel: m.methodLabel,
      asr: m.asr,
      auto: m.auto,
      baghdadCalibrated: m.baghdadCalibrated,
      city: q.city,
      country: q.country,
      date: q.date,
    });

    res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
    res.json(payload);
  });

  // Monthly table (docs/V2_REDESIGN_SPEC.md Phase 5): ~30 engine days per hit,
  // display-only rows. Same public posture as the daily endpoint; a day of
  // rows is cacheable — clients cache per (location, month) in-session.
  r.get("/api/prayer-times/month", (req: Request, res: Response) => {
    if (!allowed(monthLimiter, req, res)) return;
    const parsed = MonthQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const q = parsed.data;
    const m = resolveMethod(q);

    const payload = buildMonthPayload({
      lat: q.lat,
      lon: q.lon,
      elevation: q.elevation,
      tz: q.tz,
      lang: q.lang,
      method: m.methodKey,
      methodLabel: m.methodLabel,
      asr: m.asr,
      auto: m.auto,
      baghdadCalibrated: m.baghdadCalibrated,
      city: q.city,
      country: q.country,
      month: q.month,
    });

    res.set("Cache-Control", PUBLIC_CACHE_CONTROL);
    res.json(payload);
  });

  return r;
}
