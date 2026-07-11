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

/**
 * Build the Express app. Middleware order matters:
 *   no-cache → json → API router → /api JSON-404 → static → SPA fallback → error handler.
 * The API router and static assets are mounted BEFORE the SPA catch-all so
 * `/api/*` and real files are never shadowed by the history fallback.
 */
export function createApp(router: Router, staticDir: string): Express {
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

  // CORS for the public API only — the native (Capacitor) app runs on a
  // `https://localhost` origin and fetches the geo endpoints cross-origin
  // (docs/NATIVE_ALARM_SPEC.md §3a). `origin: true` reflects the caller's origin;
  // the API is public + no-auth so this exposes nothing new. The SPA (same-origin)
  // is unaffected.
  app.use("/api", cors({ origin: true }));

  app.use(express.json({ limit: "16kb" }));

  app.use(router);

  // Unmatched API routes → JSON 404 (never fall through to the SPA shell).
  app.use("/api", (req: Request, res: Response) => {
    res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
  });

  // Static SPA assets (built client).
  app.use(express.static(staticDir));

  // SPA history fallback for any non-API GET — Express 5 named-wildcard syntax
  // (`app.get("*")` throws under path-to-regexp v8).
  app.get("/{*splat}", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  // Centralized error handler (must be last; identified by arity 4).
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    log.error("Unhandled error in request", err instanceof Error ? err : new Error(String(err)));
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
