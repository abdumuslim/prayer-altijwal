import express, {
  type Express,
  type Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import compression from "compression";
import path from "node:path";
import { childLogger } from "./logger.js";

const log = childLogger("app");

export interface CreateAppOptions {
  /** The public API router (prayer, geo, places, push, telemetry). */
  router: Router;
  /** Built SPA — served at / with a history fallback. */
  staticDir: string;
  /** Built admin dashboard — a SEPARATE bundle served at /admin. */
  adminDir: string;
  /** Admin API. Absent when ADMIN_PASSWORD_HASH is unset (feature disabled). */
  adminRouter?: Router;
}

/**
 * Build the Express app. Middleware order matters:
 *   compression → cache-control → admin API → /api CORS → json → API router
 *   → /api JSON-404 → /admin static+fallback → SPA static → SPA fallback
 *   → error handler.
 *
 * Two orderings here are load-bearing and covered by app.test.ts:
 *
 *  1. The admin API is mounted BEFORE `cors({ origin: true })`, so it emits no
 *     CORS headers and is reachable same-origin only. It owns its whole subtree
 *     (including OPTIONS) so nothing under /api/admin can fall through to the
 *     permissive CORS below.
 *
 *  2. /admin is mounted BEFORE the SPA history fallback, which would otherwise
 *     answer every /admin* request with the prayer-times app shell.
 */
export function createApp(opts: CreateAppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  // Response compression (defence in depth, independent of Cloudflare's edge
  // gzip/brotli, so a direct-to-origin fetch is compressed too). Default
  // settings; must sit before the routes it wraps.
  app.use(compression());

  // Cache-Control policy. The origin is a single-CPU container behind
  // Cloudflare, so letting the edge + browser cache the deterministic public
  // GETs takes real load off it, while everything stateful stays uncacheable.
  //
  // The API DEFAULTS to no-store here, ahead of routing. The only edge-cacheable
  // API responses (the prayer-times and geo GETs) opt back in from their own
  // routers, right before res.json, so the public max-age lands on a 200 ONLY:
  // a 400/404/429/500 on those same routes never reaches that line and so is
  // never pinned at the edge (the earlier "set before routing" design cached
  // errors and even an unmounted route's 404). Static-asset + SPA-shell rules
  // stay here since they are path-prefix decisions with no per-response state.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (p.startsWith("/api/")) {
      // Uncacheable unless a router explicitly opts a 200 in (prayer/geo).
      res.set("Cache-Control", "no-store");
    } else if (p.startsWith("/assets/")) {
      // Vite content-hashed bundles: the hash changes on every rebuild, so the
      // URL is a permanent handle for its bytes.
      res.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (
      p === "/" ||
      p === "/manifest.webmanifest" ||
      p.endsWith(".html") ||
      p.endsWith(".js") ||
      p.endsWith(".css")
    ) {
      // The SPA shell, the manifest, and (CRITICAL) the service worker
      // (`/sw.js`) must revalidate so an update is never pinned behind a stale
      // long-lived cache. Extension-less deep links (e.g. /times) miss this
      // prefix, so the history fallbacks below set the same no-cache explicitly
      // where they send index.html.
      res.set("Cache-Control", "no-cache");
    }
    next();
  });

  // Admin API first (see note 1 above). It gets its own body parser rather than
  // hoisting the shared one, so the public API's middleware order is unchanged.
  if (opts.adminRouter) {
    app.use("/api/admin", express.json({ limit: "16kb" }));
    app.use(opts.adminRouter);
  }

  // CORS for the public API only — the native (Capacitor) app runs on a
  // `https://localhost` origin and fetches the geo endpoints cross-origin
  // (docs/NATIVE_ALARM_SPEC.md §3a). `origin: true` reflects the caller's origin;
  // the API is public + no-auth so this exposes nothing new. The SPA (same-origin)
  // is unaffected. The admin API is deliberately NOT covered by this.
  app.use("/api", cors({ origin: true }));

  app.use(express.json({ limit: "16kb" }));

  app.use(opts.router);

  // Unmatched API routes → JSON 404 (never fall through to the SPA shell).
  app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  // Admin dashboard: its own bundle, never part of the SPA build (and so never
  // inside the Android APK, which packages client/dist).
  const adminIndex = path.join(opts.adminDir, "index.html");
  app.use("/admin", adminSecurityHeaders, express.static(opts.adminDir));
  app.get("/admin{/*splat}", adminSecurityHeaders, (_req: Request, res: Response) => {
    // Sends index.html, so revalidate rather than let a stale shell pin (send()
    // leaves an already-set Cache-Control untouched).
    res.set("Cache-Control", "no-cache");
    res.sendFile(adminIndex, (err) => {
      if (!err || res.headersSent) return;
      // Missing bundle is an operator mistake, not a crash: say what to run.
      res
        .status(503)
        .type("text/plain")
        .send("Admin bundle not built. Run: npm --prefix client run build:admin");
    });
  });

  // Static SPA assets (built client).
  app.use(express.static(opts.staticDir));

  // SPA history fallback for any non-API GET — Express 5 named-wildcard syntax
  // (`app.get("*")` throws under path-to-regexp v8).
  app.get("/{*splat}", (_req: Request, res: Response) => {
    // Deep-link paths (no extension) skipped the no-cache prefix above; the
    // shell must revalidate like the root document (send() leaves an
    // already-set Cache-Control untouched, so this is the effective value).
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(opts.staticDir, "index.html"));
  });

  // Centralized error handler (must be last; identified by arity 4).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error("Unhandled error in request", err instanceof Error ? err : new Error(String(err)));
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

/**
 * The dashboard is a private operator tool: deny framing, pin the CSP to
 * self-hosted assets, and send no referrer. `frame-src` allows the Google Maps
 * Embed iframe used to preview a contributed masjid's location.
 *
 * `img-src` additionally names **tile.openstreetmap.org** (2026-07-26): the
 * Cost and Audience demand maps render a real Leaflet basemap
 * (`client/admin/components/TileMap.tsx`). Tiles are plain <img> loads, which is
 * why this is an `img-src` entry and **`connect-src` stays `'self'`** — the
 * dashboard still cannot talk to any third-party origin. Leaflet itself is
 * bundled, not CDN-loaded, so `script-src` stays `'self'` too. `*.tile.` covers
 * OSM's legacy a/b/c subdomains in case the URL template is ever changed back.
 */
function adminSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.set({
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://maps.gstatic.com https://maps.googleapis.com " +
      "https://tile.openstreetmap.org https://*.tile.openstreetmap.org; " +
      "frame-src https://www.google.com; connect-src 'self'; base-uri 'none'; form-action 'none'",
  });
  next();
}
