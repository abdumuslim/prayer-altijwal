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

const log = childLogger("push/routes");

const DEFAULT_PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

export interface PushRouterDeps {
  subsRepo: SubscriptionsRepo;
  alertRulesRepo: AlertRulesRepo;
  /** Public VAPID key to hand the client; null when web-push is unconfigured. */
  vapidPublicKey: string | null;
  /** Whether subscriptions can be accepted (DB + VAPID both present). */
  pushEnabled: boolean;
}

/** Push router: VAPID key handoff + subscribe / unsubscribe / prefs. */
export function createPushRouter(deps: PushRouterDeps): Router {
  const r = Router();

  r.get("/api/push/vapid-key", (_req: Request, res: Response) => {
    if (!deps.vapidPublicKey) {
      res.status(503).json({ error: "Web-push is not configured" });
      return;
    }
    res.json({ publicKey: deps.vapidPublicKey });
  });

  r.post("/api/push/subscribe", async (req: Request, res: Response) => {
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
    const parsed = AlertRuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }
    const { endpoint, timing, prayers } = parsed.data;
    const minutes = timing === "at_time" ? null : (parsed.data.minutes ?? null);
    try {
      const alert = await deps.alertRulesRepo.create({ endpoint, timing, minutes, prayers });
      res.status(201).json({ alert });
    } catch (error: unknown) {
      log.error("Create alert failed", error instanceof Error ? error : { error });
      res.status(500).json({ error: "Failed to create reminder" });
    }
  });

  r.put("/api/push/alerts/:id", async (req: Request, res: Response) => {
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
    const { endpoint, timing, prayers } = parsed.data;
    const minutes = timing === "at_time" ? null : (parsed.data.minutes ?? null);
    try {
      const alert = await deps.alertRulesRepo.update(id, endpoint, { timing, minutes, prayers });
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
