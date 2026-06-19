import { Router, type Request, type Response } from "express";
import { childLogger } from "../logger.js";
import type { SubscriptionsRepo, Subscription } from "../db/repositories/subscriptions.js";
import { SubscribeBody, UnsubscribeBody, PrefsBody } from "../validation/push.js";

const log = childLogger("push/routes");

export interface PushRouterDeps {
  subsRepo: SubscriptionsRepo;
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
      leadMinutes: b.leadMinutes,
      prayers: b.prayers,
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

  return r;
}
