import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { childLogger } from "../logger.js";
import {
  MasjidContributionBody,
  PlacesMasjidsQuery,
  PlacesTravelQuery,
} from "../validation/places.js";
import { haversineKm } from "../util/geo-distance.js";
import { isInIraqBbox } from "./iraq-bbox.js";
import { createMasjidService, type MasjidLookup, type ServedMasjid } from "./masjid-service.js";
import { createTravelService, UNITS_PER_TRAVEL_LOOKUP } from "./travel-service.js";
import { RollingBudget } from "./breaker.js";
import { clientIdOf, clientIpOf, ipPrefix } from "./identity.js";
import { createSlidingLimiter } from "../http/rate-limit.js";
import { ptDayKey } from "./budget.js";
import type { PlacesGovernor, Spender } from "./governor.js";
import type { ResidentIndex } from "./resident-index.js";
import type { PlacesCacheRepo } from "../db/repositories/places-cache.js";
import type { MasjidContributionsRepo } from "../db/repositories/masjid-contributions.js";
import type { PlacesOutcome, PlacesStatsRecorder } from "../db/repositories/places-stats.js";

export type { ServedMasjid } from "./masjid-service.js";

const log = childLogger("places/routes");

/**
 * Global upstream burst breaker (ADR-011, retuned by ADR-014).
 *
 * A cache miss used to cost 3 units (1 Places + 2 Routes) because the whole
 * visible list was priced eagerly. Travel times are now fetched one row at a
 * time, on expand, so a masjid miss costs 1 and a travel lookup costs 2.
 *
 * This bounds a BURST. The persistent daily/monthly governor bounds the VOLUME —
 * 30 units/minute sustained would still outrun any free tier, which is precisely
 * the gap ADR-011 left open and places/budget.ts closes. The GCP-side quota cap
 * remains the hard billing backstop behind both.
 */
const UPSTREAM_MAX_PER_MIN = 30;
const UNITS_PER_MASJID_SEARCH = 1;

/** How far from the submitter a contributed masjid may be pinned. */
const MAX_CONTRIBUTION_DISTANCE_KM = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Contributions per IP prefix per day, ALONGSIDE the repo's per-client cap. The
 * per-client cap is keyed on the forgeable X-Client-Id, so a single abuser can
 * mint a fresh id per request and sail past it; the IP-prefix cap is the bound
 * that survives that. Set several times the per-client cap so genuine users
 * sharing a NAT are unaffected.
 */
const CONTRIB_PER_IP_PER_DAY = 20;

export interface PlacesRouterDeps {
  /** Google Places API key; undefined ⇒ the endpoints report `enabled: false`. */
  apiKey: string | undefined;
  /**
   * Maps Embed API key, echoed to the client so an expanded masjid row can show
   * an interactive directions map. SEPARATE from `apiKey` on purpose: this one
   * is browser-visible, so it must be restricted to the Embed API (which is free
   * and unmetered) — never reuse the Places key here.
   */
  embedKey?: string | undefined;
  /** Durable 30-day cell cache; absent ⇒ in-process memory only. */
  cacheRepo?: PlacesCacheRepo | undefined;
  /** Free OSM + community masjids; absent ⇒ Google is the only source. */
  resident?: ResidentIndex | undefined;
  /** Persistent spend governor; absent ⇒ the burst breaker alone. */
  governor?: PlacesGovernor | undefined;
  /**
   * Fail closed when `governor` is absent (docs/QIBLA_MASJID_SPEC.md §6d). The
   * burst breaker alone resets on restart, so a paid Google call made without
   * the PERSISTENT governor is effectively ungoverned across a DB outage. Set by
   * index.ts on any DB-backed deploy: when the pool is down the router serves
   * resident-dataset results only (degraded, zero Google spend) instead of
   * spending unbudgeted. Defaults off so the service-logic tests, which omit the
   * governor deliberately, keep exercising the live path.
   */
  requireGovernor?: boolean | undefined;
  /** Anonymous request telemetry; absent ⇒ nothing is recorded. */
  stats?: PlacesStatsRecorder | undefined;
  /** Store for user-submitted masjids; absent ⇒ contributions are unavailable. */
  contributions?: MasjidContributionsRepo | undefined;
  /** Guards GET /api/places/usage; absent ⇒ that route 404s. */
  adminToken?: string | undefined;
  /**
   * Runtime kill-switches set from the admin dashboard (docs/ADMIN_DASHBOARD.md).
   * Absent, or resolving from a settings store that cannot be read, means ON:
   * the operator's safety valve must never fail closed by accident.
   */
  isEnabled?: (() => Promise<boolean>) | undefined;
  isTravelEnabled?: (() => Promise<boolean>) | undefined;
  /** Overridable so the per-IP contribution cap can be exercised in a test. */
  contributionLimits?: { perIpPerDay?: number } | undefined;
}

/**
 * Constant-time token check. Compares byte length first because timingSafeEqual
 * throws on unequal lengths — the length itself is not the secret.
 */
function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Map a completed lookup onto the outcome recorded for it. */
function outcomeOf(result: MasjidLookup, spender: Spender | null): PlacesOutcome {
  if (result.source !== "degraded") return result.source;
  return spender?.deniedReason() ?? "degraded_upstream";
}

/**
 * Places router (docs/QIBLA_MASJID_SPEC.md §6a). The key never leaves the
 * server; the client only sees mapped results.
 *
 * GET /api/places/masjids — the list. Always 200 unless validation fails:
 *   { enabled: false, masjids: [] }                    — no key configured
 *   { enabled: true,  masjids: ServedMasjid[], embedKey? }
 *   { enabled: true,  masjids: [...], degraded: true } — best free answer only
 * Optional `source=google`: the same shapes, built from Google results alone.
 *
 * GET /api/places/travel — REAL walk/drive minutes for ONE masjid, spent only
 * when the user expands a row.
 *
 * GET /api/places/usage — operator view of the budget (token-gated).
 */
export function createPlacesRouter(deps: PlacesRouterDeps): Router {
  const r = Router();
  const breaker = new RollingBudget(UPSTREAM_MAX_PER_MIN);

  // Per-IP-prefix daily cap for contributions, backing up the repo's forgeable
  // per-client cap. Per-key only — a global ceiling would let one abuser lock
  // out every contributor, and the repo's client cap already bounds the total.
  const contribLimiter = createSlidingLimiter({
    windowMs: DAY_MS,
    perKey: deps.contributionLimits?.perIpPerDay ?? CONTRIB_PER_IP_PER_DAY,
  });

  const burstAllows = (units: number): boolean => {
    if (breaker.tryConsume(units)) return true;
    if (breaker.takeWarning()) {
      log.warn("places upstream budget breaker tripped", { perMinute: UPSTREAM_MAX_PER_MIN });
    }
    return false;
  };

  const masjids = deps.apiKey
    ? createMasjidService({
        apiKey: deps.apiKey,
        cacheRepo: deps.cacheRepo,
        resident: deps.resident,
      })
    : null;
  const travel = deps.apiKey ? createTravelService(deps.apiKey) : null;

  /** Identify the caller and open its budget for this request. */
  async function open(req: Request): Promise<Spender | null> {
    if (!deps.governor) return null;
    const ipKey = ipPrefix(clientIpOf(req));
    return deps.governor.open(clientIdOf(req, ipKey), ipKey);
  }

  /** Burst breaker first (cheap, in-memory), then the persistent governor. */
  function spender(units: number, s: Spender | null): () => Promise<boolean> {
    return async () => {
      // Fail closed when the persistent governor is required but missing (DB
      // down). A `null` spender means no governor; refusing here degrades the
      // lookup to its free resident answer with zero Google spend, rather than
      // letting the restart-resettable burst breaker be the only bound.
      if (!s && deps.requireGovernor) return false;
      if (!burstAllows(units)) return false;
      if (!s) return true;
      return s.spend(units);
    };
  }

  r.get("/api/places/masjids", async (req: Request, res: Response) => {
    const parsed = PlacesMasjidsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const { lat, lon, source } = parsed.data;
    // Iraq-only geofence (owner decision 2026-08-26, docs/QIBLA_MASJID_SPEC.md).
    // The resident dataset is Iraq-only, so a non-Iraq coordinate can never be
    // answered here: return the same feature-disabled shape and stop before any
    // governor/DB open, resident lookup, Google call, or telemetry write. A
    // non-Iraq caller touches nothing (the zero-DB contract). This is the
    // server-side floor under the client section gating: no spend can happen for
    // a non-Iraq caller regardless of client behaviour.
    if (!isInIraqBbox(lat, lon)) {
      res.json({ enabled: false, masjids: [] });
      return;
    }
    // Runtime kill-switch from the admin dashboard. Falls back to "on" if the
    // settings store (or the whole database) is unavailable, so an outage can
    // never silently disable the feature.
    if (!masjids || !(await deps.isEnabled?.() ?? true)) {
      deps.stats?.noteOutcome(ptDayKey(), new Date().getUTCHours(), "disabled", 0);
      res.json({ enabled: false, masjids: [] });
      return;
    }

    const s = await open(req);
    // `source=google` (the watch app): Google's own names, no resident union.
    const result = await masjids.lookup(lat, lon, spender(UNITS_PER_MASJID_SEARCH, s), {
      googleOnly: source === "google",
    });

    if (deps.stats) {
      const day = s?.day ?? ptDayKey();
      const hour = s?.hour ?? new Date().getUTCHours();
      deps.stats.noteOutcome(day, hour, outcomeOf(result, s), s?.spent() ?? 0);
      deps.stats.noteCell(day, result.cellKey, result.source === "live");
    }

    const body: {
      enabled: true;
      masjids: ServedMasjid[];
      embedKey?: string;
      degraded?: true;
    } = { enabled: true, masjids: result.masjids };
    if (deps.embedKey) body.embedKey = deps.embedKey;
    if (result.degraded) body.degraded = true;
    res.json(body);
  });

  r.get("/api/places/travel", async (req: Request, res: Response) => {
    const parsed = PlacesTravelQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", issues: parsed.error.issues });
      return;
    }
    const { lat, lon, dlat, dlon } = parsed.data;
    // Iraq-only geofence (owner decision 2026-08-26): a caller outside Iraq has
    // no masjid list to buy a travel time for, and a destination outside Iraq is
    // one this feature never serves. Require BOTH the origin and the destination
    // inside the bbox, and refuse with the disabled shape before any governor/DB
    // open or Google Routes call.
    if (!isInIraqBbox(lat, lon) || !isInIraqBbox(dlat, dlon)) {
      res.json({ enabled: false, walkMin: null, driveMin: null });
      return;
    }
    // Travel lookups are the expensive half (2 units each), so they have their
    // own switch — the masjid list can stay on while these are turned off.
    if (!travel || !(await deps.isTravelEnabled?.() ?? true)) {
      res.json({ enabled: false, walkMin: null, driveMin: null });
      return;
    }

    const s = await open(req);
    const found = await travel.lookup(
      { lat, lon },
      { lat: dlat, lon: dlon },
      spender(UNITS_PER_TRAVEL_LOOKUP, s),
    );

    if (deps.stats) {
      const day = s?.day ?? ptDayKey();
      const hour = s?.hour ?? new Date().getUTCHours();
      const spent = s?.spent() ?? 0;
      const outcome: PlacesOutcome = !found
        ? (s?.deniedReason() ?? "degraded_upstream")
        : spent > 0
          ? "travel_live"
          : "travel_cached";
      deps.stats.noteOutcome(day, hour, outcome, spent);
    }

    if (!found) {
      // The client keeps its own estimate — this is not an error state.
      res.json({ enabled: true, walkMin: null, driveMin: null, degraded: true });
      return;
    }
    res.json({ enabled: true, walkMin: found.walkMin, driveMin: found.driveMin });
  });

  // A masjid the user knows about that neither source lists. Free, so it is
  // gated only by validation and a per-client daily cap — no budget involved.
  r.post("/api/places/masjids/contribute", async (req: Request, res: Response) => {
    const parsed = MasjidContributionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid contribution", issues: parsed.error.issues });
      return;
    }
    if (!deps.contributions) {
      res.status(503).json({ error: "Contributions unavailable" });
      return;
    }

    const { name, lat, lon, userLat, userLon } = parsed.data;
    // Sanity, not security: stops a mis-dragged pin landing on another continent.
    if (haversineKm(userLat, userLon, lat, lon) > MAX_CONTRIBUTION_DISTANCE_KM) {
      res.status(400).json({ error: "Too far from your location" });
      return;
    }
    // Iraq-only geofence (owner decision 2026-08-26): the resident index is
    // Iraq-only, so a masjid pinned outside the bbox could never be served even
    // if approved, and a submitter outside Iraq has no in-area masjid to add.
    // Require BOTH the pin and the submitter inside the bbox, and refuse with the
    // same shape as a disabled store, before any DB write.
    if (!isInIraqBbox(lat, lon) || !isInIraqBbox(userLat, userLon)) {
      res.status(503).json({ error: "Contributions unavailable" });
      return;
    }

    const ipKey = ipPrefix(clientIpOf(req));
    // IP-prefix daily cap first — the bound a client-id rotator cannot dodge.
    if (!contribLimiter.allow(ipKey)) {
      res.status(429).json({ error: "Daily contribution limit reached" });
      return;
    }
    const accepted = await deps.contributions.submit({
      name,
      lat,
      lon,
      clientId: clientIdOf(req, ipKey),
    });
    if (!accepted) {
      res.status(429).json({ error: "Daily contribution limit reached" });
      return;
    }
    res.status(201).json({ ok: true });
  });

  // Operator view: what the governor currently believes, so the budget can be
  // watched without reading the database by hand. 404 (not 401) without a token
  // configured, so the endpoint's existence isn't advertised.
  r.get("/api/places/usage", async (req: Request, res: Response) => {
    // Constant-time: a plain !== short-circuits on the first differing byte,
    // which leaks the token one character at a time to a patient caller. Every
    // other secret comparison in the codebase already uses timingSafeEqual.
    if (!deps.adminToken || !tokenMatches(req.query.token, deps.adminToken)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!deps.governor) {
      res.json({ enabled: false });
      return;
    }
    const plan = await deps.governor.plan();
    res.json({
      enabled: true,
      billingDay: ptDayKey(),
      memCells: masjids?.memSize() ?? 0,
      burstRemaining: breaker.remaining(),
      ...plan,
    });
  });

  return r;
}
