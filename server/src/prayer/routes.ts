import { Router, type Request, type Response } from "express";
import type { AsrMadhab, MethodName } from "../prayer-engine/index.js";
import { MonthQuery, PrayerTimesQuery } from "../validation/prayer-times.js";
import { describeMethod, detectMethod } from "./method-detect.js";
import { buildPrayerTimesPayload } from "./payload.js";
import { buildMonthPayload } from "./month-payload.js";

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

export function createPrayerRouter(): Router {
  const r = Router();

  r.get("/api/prayer-times", (req: Request, res: Response) => {
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

    res.json(payload);
  });

  // Monthly table (docs/V2_REDESIGN_SPEC.md Phase 5): ~30 engine days per hit,
  // display-only rows. Same public posture as the daily endpoint; a day of
  // rows is cacheable — clients cache per (location, month) in-session.
  r.get("/api/prayer-times/month", (req: Request, res: Response) => {
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

    res.json(payload);
  });

  return r;
}
