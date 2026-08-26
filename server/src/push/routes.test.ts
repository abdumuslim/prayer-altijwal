import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createPushRouter, type PushRouterDeps } from "./routes.js";
import type {
  SubscriptionsRepo,
  Subscription,
  SubscriptionPrefs,
} from "../db/repositories/subscriptions.js";
import { MAX_ALERT_RULES_PER_ENDPOINT } from "../db/repositories/alert-rules.js";
import type {
  AlertRule,
  AlertRuleInput,
  AlertRulesRepo,
  CreateAlertResult,
} from "../db/repositories/alert-rules.js";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/ep1";

class FakeSubsRepo implements SubscriptionsRepo {
  subs: Subscription[] = [];
  async upsert(sub: Subscription): Promise<void> {
    this.subs = [...this.subs.filter((s) => s.endpoint !== sub.endpoint), sub];
  }
  async deleteByEndpoint(endpoint: string): Promise<void> {
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
  }
  async deleteById(): Promise<boolean> {
    return false;
  }
  async updatePrefs(endpoint: string, prefs: SubscriptionPrefs): Promise<void> {
    this.subs = this.subs.map((s) => (s.endpoint === endpoint ? { ...s, ...prefs } : s));
  }
  async listAll(): Promise<Subscription[]> {
    return this.subs;
  }
}

class FakeRulesRepo implements AlertRulesRepo {
  private seq = 0;
  constructor(public rules: AlertRule[] = []) {
    this.seq = rules.reduce((m, r) => Math.max(m, r.id), 0);
  }
  async listByEndpoint(endpoint: string): Promise<AlertRule[]> {
    return this.rules.filter((r) => r.endpoint === endpoint);
  }
  async listAll(): Promise<AlertRule[]> {
    return this.rules;
  }
  async create(input: AlertRuleInput): Promise<CreateAlertResult> {
    // The cap now lives in the repo (create() enforces it atomically), so the
    // fake mirrors that: over the per-endpoint ceiling it signals a refusal
    // instead of inserting, exactly as the Postgres create() does.
    const count = this.rules.filter((r) => r.endpoint === input.endpoint).length;
    if (count >= MAX_ALERT_RULES_PER_ENDPOINT) return { ok: false, reason: "limit" };
    const rule = { id: ++this.seq, ...input };
    this.rules.push(rule);
    return { ok: true, rule };
  }
  async update(): Promise<AlertRule | null> {
    return null;
  }
  async delete(): Promise<void> {
    /* no-op */
  }
}

function seededRules(n: number): AlertRule[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    endpoint: ENDPOINT,
    timing: "at_time" as const,
    minutes: null,
    prayers: ["fajr"],
    kind: "notification" as const,
  }));
}

describe("push routes: write hardening", () => {
  let server: Server;
  let base: string;

  async function start(over: Partial<PushRouterDeps> = {}): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use(
      createPushRouter({
        subsRepo: new FakeSubsRepo(),
        alertRulesRepo: new FakeRulesRepo(),
        vapidPublicKey: "vapid",
        pushEnabled: true,
        ...over,
      }),
    );
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const postAlert = (): Promise<globalThis.Response> =>
    fetch(`${base}/api/push/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: ENDPOINT, timing: "at_time", prayers: ["fajr"] }),
    });

  it("caps alert rules per endpoint at creation", async () => {
    await start({ alertRulesRepo: new FakeRulesRepo(seededRules(40)) });
    const res = await postAlert();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  it("allows creation while under the per-endpoint cap", async () => {
    await start({ alertRulesRepo: new FakeRulesRepo(seededRules(39)) });
    const res = await postAlert();
    expect(res.status).toBe(201);
  });

  it("rate-limits write requests per IP prefix", async () => {
    await start({ writeLimits: { perIpPerHour: 2, globalPerHour: 1000 } });
    expect((await postAlert()).status).toBe(201);
    expect((await postAlert()).status).toBe(201);
    expect((await postAlert()).status).toBe(429);
  });

  // Every MUTATING push route shares the write limiter, not just subscribe and
  // alert create/update. Unsubscribe, prefs and alert-delete were previously
  // unguarded; a scripted flood could churn them without limit.
  it("rate-limits unsubscribe, prefs, and alert-delete like the other writes", async () => {
    await start({ writeLimits: { perIpPerHour: 1, globalPerHour: 1000 } });

    const call = (path: string, method: string, body?: object): Promise<globalThis.Response> =>
      fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });

    // Burn the single per-IP allowance on one mutating route.
    expect((await call("/api/push/unsubscribe", "POST", { endpoint: ENDPOINT })).status).toBe(200);

    // Now every mutating route shares the tripped limiter and must 429.
    expect((await call("/api/push/prefs", "POST", { endpoint: ENDPOINT, lang: "ar" })).status).toBe(
      429,
    );
    const del = `/api/push/alerts/1?endpoint=${encodeURIComponent(ENDPOINT)}`;
    expect((await call(del, "DELETE")).status).toBe(429);
    expect((await call("/api/push/unsubscribe", "POST", { endpoint: ENDPOINT })).status).toBe(429);
  });
});
