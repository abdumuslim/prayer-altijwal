import { Router, type Request, type Response } from "express";
import { childLogger } from "../logger.js";
import type { SubscriptionsRepo, Subscription } from "../db/repositories/subscriptions.js";
import type { AlertRulesRepo } from "../db/repositories/alert-rules.js";
import {
  SubscribeBody,
  UnsubscribeBody,
  PrefsBody,
  AlertRuleBody,
  AlertDeleteQuery,
} from "../validation/push.js";
import { clientIpOf, ipPrefix } from "../places/identity.js";
import { createSlidingLimiter } from "../http/rate-limit.js";

const log = childLogger("push/routes");

const DEFAULT_PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

const HOUR_MS = 60 * 60 * 1000;
/** Per-IP-prefix write budget: generous for a real device configuring reminders
 *  (subscribe + a handful of rules) while bounding a scripted flood. */
const WRITES_PER_IP_PER_HOUR = 60;
/** Global backstop across all keys — sized well above plausible legitimate
 *  traffic, mirroring the telemetry router's forgeable-header defence. */
const WRITES_GLOBAL_PER_HOUR = 2000;

export interface PushRouterDeps {
  subsRepo: SubscriptionsRepo;
  alertRulesRepo: AlertRulesRepo;
  /** Public VAPID key to hand the client; null when web-push is unconfigured. */
  vapidPublicKey: string | null;
  /** Whether subscriptions can be accepted (DB + VAPID both present). */
  pushEnabled: boolean;
  /** Overridable so the write caps can be exercised in a test without 60 requests. */
  writeLimits?: { perIpPerHour?: number; globalPerHour?: number };
}

/** Push router: VAPID key handoff + subscribe / unsubscribe / prefs. */
export function createPushRouter(deps: PushRouterDeps): Router {
  const r = Router();

  // One per-IP-prefix + global limiter shared by every MUTATING push route
  // (subscribe, unsubscribe, prefs, alert create/update/delete); a read like
  // GET /alerts is exempt. Same hand-rolled idiom as the telemetry router.
  const writeLimiter = createSlidingLimiter({
    windowMs: HOUR_MS,
    perKey: deps.writeLimits?.perIpPerHour ?? WRITES_PER_IP_PER_HOUR,
    globalPerWindow: deps.writeLimits?.globalPerHour ?? WRITES_GLOBAL_PER_HOUR,
    onGlobalTrip: () =>
      log.warn("push write global rate cap reached — writes dropped this hour"),
  });

  /** Guard a write route. Responds 429 and returns false when over a cap. */
  function writeAllowed(req: Request, res: Response): boolean {
    if (writeLimiter.allow(ipPrefix(clientIpOf(req)))) return true;
    res.status(429).json({ error: "Too many requests" });
    return false;
  }

  r.get("/api/push/vapid-key", (_req: Request, res: Response) => {
    if (!deps.vapidPublicKey) {
      res.status(503).json({ error: "Web-push is not configured" });
      return;
    }
    res.json({ publicKey: deps.vapidPublicKey });
  });

  r.post("/api/push/subscribe", async (req: Request, res: Response) => {
    if (!writeAllowed(req, res)) return;
    if (!deps.pushEnabled) {
      res.status(503).json({ error: "Web-push is not enabled" });
      return;
    }
    const parsed = SubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    const b = parsed.data;
    const sub: Subscription = {
      endpoint: b.subscription.endpoint,
      subscription: b.subscription,
      lat: b.lat,
      lon: b.lon,
      tz: b.tz,
      country: b.country ?? null,
      method: b.method ?? "MWL",
      asr: b.asr ?? "Standard",
      // Legacy columns — reminders live in prayer_alert_rules now.
      leadMinutes: b.leadMinutes ?? [0],
      prayers: b.prayers ?? DEFAULT_PRAYERS,
      lang: b.lang,
    };
    try {
      await deps.subsRepo.upsert(sub);
      res.status(201).json({ ok: true });
    } catch (error: unknown) {
      log.error("Subscribe failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to store subscription" });
    }
  });

  r.post("/api/push/unsubscribe", async (req: Request, res: Response) => {
    if (!writeAllowed(req, res)) return;
    const parsed = UnsubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    try {
      await deps.subsRepo.deleteByEndpoint(parsed.data.endpoint);
      res.json({ ok: true });
    } catch (error: unknown) {
      log.error("Unsubscribe failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to remove subscription" });
    }
  });

  r.post("/api/push/prefs", async (req: Request, res: Response) => {
    if (!writeAllowed(req, res)) return;
    const parsed = PrefsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    const { endpoint, ...prefs } = parsed.data;
    try {
      await deps.subsRepo.updatePrefs(endpoint, prefs);
      res.json({ ok: true });
    } catch (error: unknown) {
      log.error("Prefs update failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to update preferences" });
    }
  });

  // ── Reminder rules (multiple independent alerts per device) ────────────────

  r.get("/api/push/alerts", async (req: Request, res: Response) => {
    const endpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : "";
    if (!endpoint) {
      res.status(400).json({ error: "endpoint is required" });
      return;
    }
    try {
      const alerts = await deps.alertRulesRepo.listByEndpoint(endpoint);
      res.json({ alerts });
    } catch (error: unknown) {
      log.error("List alerts failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to list reminders" });
    }
  });

  r.post("/api/push/alerts", async (req: Request, res: Response) => {
    if (!writeAllowed(req, res)) return;
    const parsed = AlertRuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    const { endpoint, timing, prayers, kind } = parsed.data;
    const minutes = timing === "at_time" ? null : (parsed.data.minutes ?? null);
    try {
      // The per-endpoint cap is enforced atomically inside create() (a
      // list-then-insert here would let concurrent creates race past it); a real
      // client never approaches it, so hitting it means an automated writer.
      // Same 4xx { error } shape the route already uses for a rejected body.
      const result = await deps.alertRulesRepo.create({ endpoint, timing, minutes, prayers, kind });
      if (!result.ok) {
        res.status(400).json({ error: "Reminder limit reached" });
        return;
      }
      res.status(201).json({ alert: result.rule });
    } catch (error: unknown) {
      log.error("Create alert failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to create reminder" });
    }
  });

  r.put("/api/push/alerts/:id", async (req: Request, res: Response) => {
    if (!writeAllowed(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid alert id" });
      return;
    }
    const parsed = AlertRuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    const { endpoint, timing, prayers, kind } = parsed.data;
    const minutes = timing === "at_time" ? null : (parsed.data.minutes ?? null);
    try {
      const alert = await deps.alertRulesRepo.update(id, endpoint, { timing, minutes, prayers, kind });
      if (!alert) {
        res.status(404).json({ error: "Reminder not found" });
        return;
      }
      res.json({ alert });
    } catch (error: unknown) {
      log.error("Update alert failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to update reminder" });
    }
  });

  r.delete("/api/push/alerts/:id", async (req: Request, res: Response) => {
    if (!writeAllowed(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid alert id" });
      return;
    }
    const parsed = AlertDeleteQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "endpoint is required" });
      return;
    }
    try {
      await deps.alertRulesRepo.delete(id, parsed.data.endpoint);
      res.json({ ok: true });
    } catch (error: unknown) {
      log.error("Delete alert failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to delete reminder" });
    }
  });

  return r;
}
