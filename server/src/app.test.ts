import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Router } from "express";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app.js";
import { createRouter } from "./router.js";
import { createAdminRouter } from "./admin/index.js";
import { hashPassword } from "./admin/auth.js";
import { createPrayerRouter } from "./prayer/routes.js";
import { createGeoRouter } from "./geo/routes.js";
import { CitiesIndex } from "./geo/cities-index.js";

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
  // A real content-hashed asset, so the immutable-cache rule can be asserted
  // against a file express.static actually serves (a MISSING asset would fall
  // through to the SPA history fallback and pick up its no-cache instead).
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "assets", "app-abc123.js"), "export const x = 1;\n");
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

async function start(withAdmin: boolean, featureRouters: Router[] = []): Promise<Harness> {
  const app = createApp({
    router: createRouter({ getDbStatus: async () => "disabled", featureRouters }),
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

describe("Cache-Control policy", () => {
  let h: Harness;
  beforeAll(async () => {
    // The REAL prayer + geo routers are mounted so the full pipeline (no-store
    // default set ahead of routing → the router opting a 200 back in) is
    // exercised, rather than pinning the old bug where an unmounted route's 404
    // still carried a public max-age.
    const cities = CitiesIndex.load();
    h = await start(false, [createPrayerRouter(), createGeoRouter(cities)]);
  });
  afterAll(() => h.close());

  const cc = async (path: string): Promise<string | null> =>
    (await fetch(`${h.base}${path}`)).headers.get("cache-control");

  it("lets the edge cache only the SUCCESSFUL public GETs", async () => {
    const daily = await fetch(`${h.base}/api/prayer-times?lat=33&lon=44&tz=Asia/Baghdad`);
    expect(daily.status).toBe(200);
    expect(daily.headers.get("cache-control")).toBe("public, max-age=60");

    const search = await fetch(`${h.base}/api/geo/search?q=mecca`);
    expect(search.status).toBe(200);
    expect(search.headers.get("cache-control")).toBe("public, max-age=21600");
  });

  it("never lets a 4xx on those same public routes be cached", async () => {
    // A bad query must not inherit the success path's public max-age: the
    // no-store default set ahead of routing stands (the old middleware set the
    // public header before routing, so errors were edge-cacheable).
    const badDaily = await fetch(`${h.base}/api/prayer-times?lat=999`);
    expect(badDaily.status).toBe(400);
    expect(badDaily.headers.get("cache-control")).toBe("no-store");

    const badGeo = await fetch(`${h.base}/api/geo/reverse?lat=999&lon=0`);
    expect(badGeo.status).toBe(400);
    expect(badGeo.headers.get("cache-control")).toBe("no-store");
  });

  it("does not cache a 404 for an unmatched API route", async () => {
    const res = await fetch(`${h.base}/api/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not cache a 429 rate-limited public GET", async () => {
    // A dedicated app with a per-IP cap of 1 so the second call trips the limit.
    const capped = await start(false, [
      createPrayerRouter({ dailyLimits: { perIpPerMinute: 1, globalPerMinute: 1000 } }),
    ]);
    try {
      const ok = await fetch(`${capped.base}/api/prayer-times?lat=33&lon=44&tz=Asia/Baghdad`);
      expect(ok.status).toBe(200);
      const over = await fetch(`${capped.base}/api/prayer-times?lat=33&lon=44&tz=Asia/Baghdad`);
      expect(over.status).toBe(429);
      expect(over.headers.get("cache-control")).toBe("no-store");
    } finally {
      await capped.close();
    }
  });

  it("never caches stateful API routes", async () => {
    expect(await cc("/api/health")).toBe("no-store");
  });

  it("makes content-hashed assets immutable but the shell + service worker revalidate", async () => {
    expect(await cc("/assets/app-abc123.js")).toBe("public, max-age=31536000, immutable");
    expect(await cc("/")).toBe("no-cache");
    expect(await cc("/sw.js")).toBe("no-cache");
    expect(await cc("/manifest.webmanifest")).toBe("no-cache");
  });

  it("serves a deep link with the SPA shell and no-cache", async () => {
    const res = await fetch(`${h.base}/times`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(SPA_MARKER);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });
});
