import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTelemetryRouter } from "./routes.js";
import type { TelemetryRepo, UsagePing } from "../db/repositories/telemetry.js";

const SALT = "test-telemetry-salt-value";

function fakeRepo() {
  const written: UsagePing[] = [];
  const repo: TelemetryRepo = {
    async record(p) {
      written.push(p);
    },
    async prune() {
      return 0;
    },
  };
  return { repo, written };
}

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

async function start(overrides: Partial<Parameters<typeof createTelemetryRouter>[0]> = {}) {
  const { repo, written } = fakeRepo();
  const app = express();
  app.use(express.json());
  app.use(
    createTelemetryRouter({
      repo,
      salt: SALT,
      precisionDeg: 0.01,
      ...overrides,
    }),
  );
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, written };
}

const VALID = {
  platform: "android",
  appVersion: "2.3.0",
  lat: 33.3152,
  lon: 44.3661,
  locSource: "gps",
  tz: "Asia/Baghdad",
  features: ["duha", "qiyam"],
  notif: true,
  theme: "night",
  displayMode: "native",
};

function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/telemetry/ping`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Id": "test-client-0001", ...headers },
    body: JSON.stringify(body),
  });
}

/** The endpoint's whole contract: it never tells you anything, and never fails. */
describe("POST /api/telemetry/ping always answers 204", () => {
  it("on a valid ping", async () => {
    const { base } = await start();
    expect((await post(base, VALID)).status).toBe(204);
  });

  it("on a body that fails validation", async () => {
    const { base, written } = await start();
    for (const bad of [
      {},
      { platform: "windows" },
      { platform: "web", lat: 999 },
      { platform: "web", appVersion: "not-a-version" },
      { platform: "web", tz: "x".repeat(200) },
    ]) {
      expect((await post(base, bad)).status).toBe(204);
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(written).toHaveLength(0);
  });

  it("(a non-object body is refused by the shared JSON parser, before the route)", async () => {
    // express.json() runs in strict mode app-wide, so a bare scalar never
    // reaches this handler. Pinned so the 204 contract is understood to be
    // about the route, not about the body parser.
    const { base } = await start();
    expect((await post(base, "nonsense")).status).toBe(400);
  });

  it("when telemetry is unconfigured (no salt)", async () => {
    const { base, written } = await start({ salt: undefined });
    expect((await post(base, VALID)).status).toBe(204);
    expect(written).toHaveLength(0);
  });

  it("when there is no database", async () => {
    const { base } = await start({ repo: undefined });
    expect((await post(base, VALID)).status).toBe(204);
  });

  it("when the admin kill-switch is off", async () => {
    const { base, written } = await start({ isEnabled: async () => false });
    expect((await post(base, VALID)).status).toBe(204);
    expect(written).toHaveLength(0);
  });

  it("even when the repository throws", async () => {
    const exploding: TelemetryRepo = {
      async record() {
        throw new Error("db exploded");
      },
      async prune() {
        return 0;
      },
    };
    const { base } = await start({ repo: exploding });
    expect((await post(base, VALID)).status).toBe(204);
  });
});

describe("what gets stored", () => {
  it("coarsens coordinates to the configured precision", async () => {
    const { base, written } = await start();
    await post(base, VALID);
    // Give the fire-and-forget handler a tick to finish after responding.
    await new Promise((r) => setTimeout(r, 20));
    expect(written[0]?.lat).toBe(33.32);
    expect(written[0]?.lon).toBe(44.37);
    expect(written[0]?.locPrecision).toBe(0.01);
  });

  it("re-clamps a client that sends finer coordinates than declared", async () => {
    // Defence in depth: a modified client must not be able to store precise GPS.
    const { base, written } = await start({ precisionDeg: 1 });
    await post(base, { ...VALID, lat: 33.31527, lon: 44.36611 });
    await new Promise((r) => setTimeout(r, 20));
    expect(written[0]?.lat).toBe(33);
    expect(written[0]?.lon).toBe(44);
  });

  it("stores the rotating hash and NEVER the client id", async () => {
    const { base, written } = await start();
    await post(base, VALID, { "X-Client-Id": "recognisable-client-id" });
    await new Promise((r) => setTimeout(r, 20));
    const stored = JSON.stringify(written[0]);
    expect(stored).not.toContain("recognisable-client-id");
    expect(written[0]?.dauHash).toHaveLength(22);
  });

  it("rejects unknown feature names rather than storing them", async () => {
    const { base, written } = await start();
    await post(base, { ...VALID, features: ["duha", "something-invented"] });
    await new Promise((r) => setTimeout(r, 20));
    expect(written).toHaveLength(0);
  });

  it("rate-limits a flood from one address", async () => {
    const { base, written } = await start();
    for (let i = 0; i < 40; i++) await post(base, VALID);
    await new Promise((r) => setTimeout(r, 30));
    // 20/hour cap; every request still answered 204.
    expect(written.length).toBeLessThanOrEqual(20);
  });
});
