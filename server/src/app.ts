import express, {
  type Express,
  type Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
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
 *   no-cache → admin API → /api CORS → json → API router → /api JSON-404
 *   → /admin static+fallback → SPA static → SPA fallback → error handler.
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

  // No-cache for API + HTML/JS/CSS so clients always get fresh app + data.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const p = req.path;
    if (p.startsWith("/api/") || p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".html")) {
      res.set("Cache-Control", "no-cache, no-store, must-revalidate");
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
 */
function adminSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.set({
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https://maps.gstatic.com https://maps.googleapis.com; " +
      "frame-src https://www.google.com; connect-src 'self'; base-uri 'none'; form-action 'none'",
  });
  next();
}
