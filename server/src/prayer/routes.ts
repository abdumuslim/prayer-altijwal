import { Router, type Request, type Response } from "express";
import type { AsrMadhab, MethodName } from "../prayer-engine/index.js";
import { PrayerTimesQuery } from "../validation/prayer-times.js";
import { describeMethod, detectMethod } from "./method-detect.js";
import { buildPrayerTimesPayload } from "./payload.js";

export function createPrayerRouter(): Router {
  const r = Router();

  r.get("/api/prayer-times", (req: Request, res: Response) => {
    const parsed = PrayerTimesQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const q = parsed.data;

    let methodKey: MethodName;
    let methodLabel: string;
    let asr: AsrMadhab;
    let auto: boolean;
    let baghdadCalibrated: boolean;

    if (q.method) {
      methodKey = q.method as MethodName;
      const desc = describeMethod(methodKey);
      methodLabel = desc.label;
      asr = q.asr ?? desc.asr;
      auto = false;
      baghdadCalibrated = methodKey === "BaghdadYMA";
    } else {
      const det = detectMethod(q.country, q.lat, q.lon);
      methodKey = det.key;
      methodLabel = det.label;
      asr = q.asr ?? det.asr;
      auto = true;
      baghdadCalibrated = det.baghdadCalibrated;
    }

    const payload = buildPrayerTimesPayload({
      lat: q.lat,
      lon: q.lon,
      elevation: q.elevation,
      tz: q.tz,
      lang: q.lang,
      method: methodKey,
      methodLabel,
      asr,
      auto,
      baghdadCalibrated,
      city: q.city,
      country: q.country,
      date: q.date,
    });

    res.json(payload);
  });

  return r;
}
