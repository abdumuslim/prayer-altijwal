import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { createRouter } from "./router.js";
import { createAdminRouter } from "./admin/index.js";
import { hashPassword } from "./admin/auth.js";

/**
 * Middleware ORDER regression tests for app.ts.
 *
 * app.ts had no test before the admin dashboard, and its ordering is the one
 * thing that fails silently: mount /admin after the SPA history fallback and
 * every admin URL quietly serves the prayer-times shell instead; mount the
 * admin API after `cors({ origin: true })` and cross-origin preflights to it
 * get approved. Both are invisible until exploited, so they are pinned here.
 *
 * Two throwaway directories stand in for the built bundles, each with a
 * distinguishable index.html, so "which app answered?" is directly assertable.
 */

const SPA_MARKER = "SPA_INDEX_MARKER";
const ADMIN_MARKER = "ADMIN_INDEX_MARKER";

function makeBundle(marker: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "prayer-test-"));
  writeFileSync(path.join(dir, "index.html"), `<!doctype html><title>${marker}</title>`);
  return dir;
}

// The REAL admin router, so this file pins actual behaviour rather than a
// stand-in's. Cheap scrypt parameters keep the suite fast.
const TEST_PASSWORD = "correct horse battery staple";
const TEST_HASH = hashPassword(TEST_PASSWORD, { N: 1024, r: 8, p: 1 });

function adminRouter() {
  return createAdminRouter({
    session: {
      passwordHash: TEST_HASH,
      sessionSecret: "test-session-secret-at-least-32-chars-long",
      secureCookies: false,
    },
    serverVersion: "test",
    startedAt: Date.now(),
    env: "test",
    getDbStatus: async () => "disabled",
    monthlyCap: 4500,
    settingsDefaults: {
      placesEnabled: false,
      placesTravelEnabled: true,
      placesMonthlyUnitCap: 4500,
      telemetryEnabled: false,
    },
    telemetryConfigured: false,
    precisionDeg: 0.01,
    retentionDays: 180,
    flags: { placesEnabled: false, pushEnabled: false, telemetryEnabled: false },
  });
}

interface Harness {
  base: string;
  close: () => Promise<void>;
}

async function start(withAdmin: boolean): Promise<Harness> {
  const app = createApp({
    router: createRouter({ getDbStatus: async () => "disabled", featureRouters: [] }),
    staticDir: makeBundle(SPA_MARKER),
    adminDir: makeBundle(ADMIN_MARKER),
    adminRouter: withAdmin ? adminRouter() : undefined,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("with the admin dashboard enabled", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start(true);
  });
  afterAll(() => h.close());

  it("serves the ADMIN bundle at /admin, not the SPA shell", async () => {
    const res = await fetch(`${h.base}/admin`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(ADMIN_MARKER);
  });

  it("serves the admin bundle for client-side sub-routes too", async () => {
    for (const p of ["/admin/", "/admin/masjids", "/admin/a/b/c"]) {
      const res = await fetch(`${h.base}${p}`);
      expect(res.status, p).toBe(200);
      expect(await res.text()).toContain(ADMIN_MARKER);
    }
  });

  it("still serves the SPA everywhere else", async () => {
    for (const p of ["/", "/times", "/administrative"]) {
      const res = await fetch(`${h.base}${p}`);
      expect(res.status, p).toBe(200);
      expect(await res.text(), p).toContain(SPA_MARKER);
    }
  });

  it("sets hardened headers on the admin bundle", async () => {
    const res = await fetch(`${h.base}/admin`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("requires a session for the admin API", async () => {
    const res = await fetch(`${h.base}/api/admin/overview`);
    expect(res.status).toBe(401);
  });

  it("404s unmatched admin API paths as JSON, never the SPA shell", async () => {
    const res = await fetch(`${h.base}/api/admin/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("does NOT approve a cross-origin preflight to the admin API", async () => {
    // The regression that matters: /api is wrapped in cors({ origin: true }),
    // so an unmatched OPTIONS falling through to it would be answered with
    // Access-Control-Allow-Origin and hand a hostile page a usable endpoint.
    const res = await fetch(`${h.base}/api/admin/session`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("still allows cross-origin use of the PUBLIC api (the native app needs it)", async () => {
    const res = await fetch(`${h.base}/api/health`, { headers: { Origin: "https://localhost" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://localhost");
  });

  it("refuses a write without the CSRF header", async () => {
    const res = await fetch(`${h.base}/api/admin/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses the wrong password with a generic message and no cookie", async () => {
    const res = await fetch(`${h.base}/api/admin/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Request": "1" },
      body: JSON.stringify({ password: "not it" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("logs in, sets a hardened cookie, and accepts it on a protected route", async () => {
    const login = await fetch(`${h.base}/api/admin/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Request": "1" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(login.status).toBe(204);

    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("padm=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/api/admin");

    const cookie = setCookie.split(";")[0];
    const overview = await fetch(`${h.base}/api/admin/overview`, { headers: { cookie } });
    expect(overview.status).toBe(200);

    const body = (await overview.json()) as Record<string, unknown>;
    expect(body.server).toBeTruthy();
    // Field whitelisting: no secret, config object, or env ever reaches a response.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(TEST_HASH);
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("passwordHash");
  });

  it("rejects a forged cookie", async () => {
    const res = await fetch(`${h.base}/api/admin/overview`, {
      headers: { cookie: "padm=eyJ2IjoxfQ.deadbeef" },
    });
    expect(res.status).toBe(401);
  });
});

describe("with the admin dashboard disabled", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await start(false);
  });
  afterAll(() => h.close());

  it("404s the admin API without advertising that it exists", async () => {
    const res = await fetch(`${h.base}/api/admin/overview`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("leaves the public API and SPA untouched", async () => {
    expect((await fetch(`${h.base}/api/health`)).status).toBe(200);
    expect(await (await fetch(`${h.base}/`)).text()).toContain(SPA_MARKER);
  });
});
