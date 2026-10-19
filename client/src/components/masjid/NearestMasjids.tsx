// Nearest-masjid section (docs/QIBLA_MASJID_SPEC.md §6b): closest mosques
// around the user's REAL GPS position via the server-side Places proxy. Each row
// shows the name (marquee when it doesn't fit), distance + walking/driving time,
// and a live bearing arrow; TAPPING a row expands an embedded Google directions
// map with the Google Maps button (2026-07-22 redesign — the buttons used to
// sit in every row; the Waze button was removed 2026-10-19). Gated on a real
// GPS fix: searching from the Baghdad default would mislead (Q5). The section
// hides itself entirely when the server reports the feature disabled.
//
// FETCH DISCIPLINE (user, 2026-07-25 — ADR-014). The list is fetched ONCE per
// mount, when the tab first opens with a real GPS fix, and thereafter only when
// the user pulls to refresh. It deliberately does NOT refetch on tab re-entry or
// when the position changes: masjids don't move, so re-asking as the user walks
// spent quota to redraw the same list. Distances and bearings still track the
// live position — only the network call is pinned.
//
// Travel times in the collapsed row are FREE estimates from straight-line
// distance («نحو 6 دقائق مشيًا»); the real Routes lookup is spent only when a row
// is expanded. Pricing all five visible rows eagerly was what capped the feature
// at ~1 000 lookups/month.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, MapPin, Navigation2, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchMasjidTravel, fetchNearbyMasjids } from "@/lib/api";
import { AddMasjidSheet } from "@/components/masjid/AddMasjidSheet";
import { readMasjidCache, writeMasjidCache } from "@/lib/masjid-cache";
import { myMasjids } from "@/lib/my-masjids";
import { haversineKm, initialBearing } from "@/lib/qibla";
import { cn } from "@/lib/utils";
import { MarqueeText } from "@/components/ui/MarqueeText";
import { MosqueIcon } from "@/components/ui/MosqueIcon";
import type { UseCompassHeading } from "@/hooks/useCompassHeading";
import type { UseLocation } from "@/hooks/useLocation";
import type { StoredLocation } from "@/lib/storage";
import type { Masjid } from "@/types/api";

const MAX_ROWS = 5;
/** Bearing arrows repaint at 10 Hz — smooth enough, a third of the sensor rate. */
const ARROW_INTERVAL_MS = 100;
/** One quiet retry before the section admits a fetch error — the proxy can hiccup
 *  (upstream 5 s timeout, the ADR-011 budget breaker) on an otherwise-fine call. */
const RETRY_DELAY_MS = 1_500;

/** Real travel minutes for one masjid, once its row has been expanded. */
interface RealTravel {
  walkMin: number | null;
  driveMin: number | null;
}

interface NearestMasjidsProps {
  location: StoredLocation;
  /** Times-tab visibility (keep-mounted tabs) — nothing fetches while hidden. */
  active: boolean;
  /** Shared heading state from TimesPage — live-rotates the row arrows. */
  compass: UseCompassHeading;
  /** High-accuracy GPS opt-in (useLocation.requestGpsStaged). */
  onUseGps: () => void;
  resolving: boolean;
  /** Last GPS request outcome — surfaces a denied/failed message in the section
   *  body (otherwise a failed tap silently does nothing on the APK). */
  gpsErrorKind: UseLocation["errorKind"];
  /** Bumped by pull-to-refresh — any change forces a refetch. */
  refreshNonce?: number;
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "disabled" }
  | {
      kind: "ready";
      masjids: Masjid[];
      embedKey?: string;
      /** Set only when we're STUCK with a non-current answer — a successful
       *  refresh clears it, so a passing revalidation never flashes a warning. */
      note?: "stale" | "offline";
    };

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} م`;
  return `${km.toFixed(1)} كم`;
}

/**
 * Arabic counts the noun by the number: 1 → دقيقة, 2 → دقيقتان (dual),
 * 3–10 → دقائق (plural), 11+ → back to the singular. English collapses to "min".
 */
function minuteUnitKey(n: number): "masjid.minute" | "masjid.minuteDual" | "masjid.minutePlural" {
  if (n === 2) return "masjid.minuteDual";
  if (n >= 3 && n <= 10) return "masjid.minutePlural";
  return "masjid.minute";
}

/**
 * Masjids can now come from OpenStreetMap or from another user («osm:» / «usr:»
 * ids), and those are meaningless to Google. Coordinates always work, so the
 * place ID is only ever an optional precision upgrade.
 */
function isGooglePlaceId(id: string): boolean {
  return !id.startsWith("osm:") && !id.startsWith("usr:");
}

export function mapsUrl(m: Masjid): string {
  const base = `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lon}`;
  return isGooglePlaceId(m.id)
    ? `${base}&destination_place_id=${encodeURIComponent(m.id)}`
    : base;
}

/** Google Maps Embed API — directions from the user to this masjid. The key is
 *  the browser-safe Embed-only one the server hands us (never the Places key).
 *  The destination is ALWAYS coordinates, never `place_id:…`: this iframe is the
 *  one deliberately un-proxied, direct-to-Google request in the feature, so it has
 *  nothing to sanitise a failure. An adopted place_id is only an optional precision
 *  upgrade (merge.ts) and can be up to 30 days stale — Google merges/refreshes
 *  mosque POIs often — and a rejected id makes the Embed API render its raw
 *  "Invalid 'destination' parameter" error page inside the card. Coordinates exist
 *  for every masjid class (google/osm/usr) and are always valid. */
export function embedUrl(m: Masjid, from: StoredLocation, key: string): string {
  const params = new URLSearchParams({
    key,
    origin: `${from.lat},${from.lon}`,
    destination: `${m.lat},${m.lon}`,
    mode: "driving",
    language: "ar",
  });
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}

export function NearestMasjids({
  location,
  active,
  compass,
  onUseGps,
  resolving,
  gpsErrorKind,
  refreshNonce = 0,
}: NearestMasjidsProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedRef = useRef<HTMLLIElement>(null);

  // Rows near the bottom would otherwise open their map UNDER the tab bar, which
  // is an absolute overlay — so scrollIntoView isn't enough (it considers the
  // row "visible" while the bar covers it). Measure the bar and scroll past it.
  useEffect(() => {
    if (!expandedId) return;
    const row = expandedRef.current;
    if (!row) return;
    const id = window.setTimeout(() => {
      const scroller = row.closest<HTMLElement>("[data-pager-page]");
      if (!scroller) return;
      const bar = document.querySelector<HTMLElement>(".tab-bar");
      const floor = bar ? bar.getBoundingClientRect().top : window.innerHeight;
      const overflow = row.getBoundingClientRect().bottom - floor + 8;
      if (overflow > 0) scroller.scrollBy({ top: overflow, behavior: "smooth" });
    }, 150); // let the panel (and its iframe box) lay out first
    return () => window.clearTimeout(id);
  }, [expandedId]);
  const fetchedRef = useRef(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [realTravel, setRealTravel] = useState<Record<string, RealTravel>>({});
  const travelAskedRef = useRef(new Set<string>());
  const [adding, setAdding] = useState(false);
  /** Bumped after a contribution so the list picks up the local copy. */
  const [mineNonce, setMineNonce] = useState(0);

  const isGpsFix = location.source === "gps";
  const { subscribe, getHeading, status: compassStatus } = compass;
  const headingLive = compassStatus === "active";

  // The effect reads the CURRENT position but must not re-run when it changes —
  // that is the whole point of the fetch discipline. A ref expresses "latest
  // value, not a dependency" precisely; putting location in the deps would
  // reinstate the per-movement refetch this change removed.
  const locRef = useRef(location);
  locRef.current = location;

  // Pull-to-refresh and the in-section retry button are the only ways to force a
  // refetch; both bump this.
  const force = refreshNonce + retryNonce;
  const lastForceRef = useRef(force);

  useEffect(() => {
    if (!active || !isGpsFix) return;

    const forced = force !== lastForceRef.current;
    lastForceRef.current = force;
    if (fetchedRef.current && !forced) return;
    fetchedRef.current = true;

    const { lat, lon } = locRef.current;

    // Paint whatever we already know instantly — no skeleton for a returning
    // user — and, if it is recent and for this same cell, ask for nothing at all.
    const cached = readMasjidCache(lat, lon);
    if (cached && cached.masjids.length > 0) {
      setState({
        kind: "ready",
        masjids: cached.masjids.slice(0, MAX_ROWS),
        embedKey: cached.embedKey,
      });
      if (cached.fresh && !forced) return;
    } else {
      setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    }

    const abort = new AbortController();
    let retryTimer = 0;

    // A transient upstream hiccup gets one quiet retry before the section admits
    // an error — a single failed poll shouldn't strand the user on «تعذّر…».
    const fail = (retriesLeft: number) => {
      if (retriesLeft > 0) {
        retryTimer = window.setTimeout(() => attempt(retriesLeft - 1), RETRY_DELAY_MS);
        return;
      }
      // A saved list beats an error screen: the masjids around the user are the
      // same ones whether or not we could reach the server just now.
      if (cached && cached.masjids.length > 0) {
        setState({
          kind: "ready",
          masjids: cached.masjids.slice(0, MAX_ROWS),
          embedKey: cached.embedKey,
          note: navigator.onLine ? "stale" : "offline",
        });
      } else {
        setState({ kind: "error" });
        fetchedRef.current = false; // let the next visit try again
      }
    };

    const attempt = (retriesLeft: number) => {
      fetchNearbyMasjids(lat, lon, abort.signal)
        .then((res) => {
          if (!res.enabled) {
            setState({ kind: "disabled" });
            return;
          }
          // Degraded WITH results is the graceful path: the server couldn't
          // spend, so it served the best free answer it had. Show it, labelled.
          if (res.degraded && res.masjids.length === 0) {
            fail(retriesLeft);
            return;
          }
          travelAskedRef.current.clear();
          setRealTravel({});
          setState({
            kind: "ready",
            masjids: res.masjids.slice(0, MAX_ROWS),
            embedKey: res.embedKey,
            ...(res.degraded ? { note: "stale" as const } : {}),
          });
          if (!res.degraded) writeMasjidCache(lat, lon, res.masjids, res.embedKey);
        })
        .catch(() => {
          if (abort.signal.aborted) return;
          fail(retriesLeft);
        });
    };
    attempt(1);

    return () => {
      abort.abort();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [active, isGpsFix, force]);

  const retry = useCallback(() => {
    fetchedRef.current = false;
    setRetryNonce((n) => n + 1);
    if (isGpsFix) setState({ kind: "loading" });
    onUseGps();
  }, [isGpsFix, onUseGps]);

  // ── Bearing arrows, driven imperatively ───────────────────────────────────
  // Subscribing here (instead of reading a heading prop) keeps the ~20 Hz sensor
  // stream from re-rendering this list — see hooks/useCompassHeading.
  const arrowsRef = useRef(new Map<string, SVGSVGElement>());
  const setArrowRef = useCallback((id: string, el: SVGSVGElement | null) => {
    if (el) arrowsRef.current.set(id, el);
    else arrowsRef.current.delete(id);
  }, []);

  // The server's list plus anything this device contributed. A contribution is
  // pending review for everyone else, but its author should see it immediately —
  // otherwise adding a masjid looks like it did nothing.
  const masjids = useMemo(() => {
    if (state.kind !== "ready") return null;
    const base = state.masjids;
    const mine = myMasjids().filter(
      (m) => !base.some((b) => haversineKm(b.lat, b.lon, m.lat, m.lon) < 0.04),
    );
    if (mine.length === 0) return base;
    return [...base, ...mine]
      .sort(
        (a, b) =>
          haversineKm(location.lat, location.lon, a.lat, a.lon) -
          haversineKm(location.lat, location.lon, b.lat, b.lon),
      )
      .slice(0, MAX_ROWS);
  }, [state, location.lat, location.lon, mineNonce]);

  // ── Real travel time, bought one row at a time ────────────────────────────
  // Expanding a row is the user telling us they care about THIS masjid, and it
  // is the only moment worth spending a Routes call on. Asked once per masjid;
  // a failure silently leaves the estimate in place.
  useEffect(() => {
    if (!expandedId || !masjids) return;
    if (travelAskedRef.current.has(expandedId)) return;
    const m = masjids.find((x) => x.id === expandedId);
    if (!m) return;
    // A masjid the user just added is at their own position — buying a route to
    // somewhere five metres away would be spending for nothing.
    if (m.id.startsWith("usr:local-")) return;
    travelAskedRef.current.add(expandedId);

    const abort = new AbortController();
    const { lat, lon } = locRef.current;
    fetchMasjidTravel(lat, lon, m.lat, m.lon, abort.signal)
      .then((res) => {
        if (!res.enabled || res.degraded) return; // keep the estimate
        if (res.walkMin == null && res.driveMin == null) return;
        setRealTravel((prev) => ({
          ...prev,
          [m.id]: { walkMin: res.walkMin, driveMin: res.driveMin },
        }));
      })
      .catch(() => {
        // Let the user ask again by re-opening the row.
        travelAskedRef.current.delete(m.id);
      });
    return () => abort.abort();
  }, [expandedId, masjids]);

  useEffect(() => {
    if (!masjids || !headingLive) return;
    const bearings = new Map(
      masjids.map((m) => [m.id, initialBearing(location.lat, location.lon, m.lat, m.lon)]),
    );
    let last = 0;
    let raf = 0;
    const paint = (now: number) => {
      raf = requestAnimationFrame(paint);
      if (now - last < ARROW_INTERVAL_MS) return;
      last = now;
      const heading = getHeading();
      if (heading == null) return;
      for (const [id, el] of arrowsRef.current) {
        const bearing = bearings.get(id);
        if (bearing != null) el.style.transform = `rotate(${bearing - heading}deg)`;
      }
    };
    const unsubscribe = subscribe(() => undefined); // keep the stream warm
    raf = requestAnimationFrame(paint);
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [masjids, headingLive, location.lat, location.lon, subscribe, getHeading]);

  // Server says no key configured — the feature doesn't exist for this deploy.
  if (state.kind === "disabled") return null;

  const gpsError = gpsErrorKind && !resolving && (
    <p className="text-center text-[12px] leading-5 text-imminent/80">
      {gpsErrorKind === "denied" ? t("error.locationDenied") : t("error.location")}
    </p>
  );

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink-dim">
        <MosqueIcon className="size-4 text-emerald" />
        {t("masjid.title")}
        {state.kind === "ready" && resolving && (
          <Loader2 className="size-3.5 animate-spin text-ink-faint" />
        )}
      </h2>

      {!isGpsFix ? (
        <div className="flex flex-col items-center gap-2.5 py-1">
          <p className="text-center text-[12px] leading-5 text-ink-dim">
            {resolving ? t("masjid.locating") : t("masjid.gpsPrompt")}
          </p>
          <button
            type="button"
            onClick={onUseGps}
            className="press hit-target flex items-center justify-center gap-2 rounded-xl border border-emerald/30 bg-emerald/[0.07] px-4 py-2.5 text-sm font-semibold text-emerald transition-colors hover:bg-emerald/[0.12]"
          >
            {resolving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MapPin className="size-4" />
            )}
            {t("masjid.gpsButton")}
          </button>
          {gpsError}
        </div>
      ) : state.kind === "loading" || state.kind === "idle" ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-veil" />
          ))}
        </div>
      ) : state.kind === "error" ? (
        <div className="flex flex-col items-center gap-2.5 py-1">
          <p className="text-center text-[12px] text-imminent/80">{t("masjid.error")}</p>
          {gpsError}
          <button
            type="button"
            onClick={retry}
            className="press hit-target rounded-xl border border-teal/30 bg-teal/[0.07] px-4 py-2 text-[13px] font-semibold text-teal transition-colors hover:bg-teal/[0.12]"
          >
            {t("masjid.retry")}
          </button>
        </div>
      ) : !masjids || masjids.length === 0 ? (
        <div className="flex flex-col gap-2.5 py-1">
          <p className="text-center text-[12px] text-ink-dim">{t("masjid.none")}</p>
          {adding ? (
            <AddMasjidSheet
              lat={location.lat}
              lon={location.lon}
              onClose={() => setAdding(false)}
              onAdded={() => setMineNonce((n) => n + 1)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="press hit-target mx-auto flex items-center gap-1.5 rounded-full border border-emerald/30 bg-emerald/[0.07] px-3 py-1.5 text-[12px] font-semibold text-emerald"
            >
              <Plus className="size-3.5" />
              {t("masjid.addCta")}
            </button>
          )}
        </div>
      ) : (
        <>
          {state.note && (
            <p className="text-center text-[11px] leading-4 text-ink-faint">
              {t(state.note === "offline" ? "masjid.offline" : "masjid.stale")}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
          {masjids.map((m) => {
            const km = haversineKm(location.lat, location.lon, m.lat, m.lon);
            const bearing = initialBearing(location.lat, location.lon, m.lat, m.lon);
            const expanded = expandedId === m.id;
            // A real lookup, once bought, replaces the estimate for that row.
            const real = realTravel[m.id];
            const walkMin = real ? real.walkMin : m.walkMin;
            const driveMin = real ? real.driveMin : m.driveMin;
            const approx = !real && m.estimated === true;
            return (
              <li
                key={m.id}
                ref={expanded ? expandedRef : undefined}
                className="flex flex-col rounded-xl border border-border-soft/60 bg-veil/[0.02]"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : m.id)}
                  aria-expanded={expanded}
                  className="press flex items-center gap-2.5 px-2.5 py-2 text-start"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald/10 text-emerald">
                    <MosqueIcon className="size-4.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <MarqueeText className="text-[13px] font-semibold text-ink">
                      {m.name}
                    </MarqueeText>
                    <span className="tnum text-[11px] text-ink-faint">
                      {formatDistance(km)}
                      {walkMin != null && (
                        <>
                          {" · "}
                          {approx && `${t("masjid.approx")} `}
                          {walkMin} {t(minuteUnitKey(walkMin))} {t("masjid.walk")}
                        </>
                      )}
                      {driveMin != null && (
                        <>
                          {" · "}
                          {approx && `${t("masjid.approx")} `}
                          {driveMin} {t(minuteUnitKey(driveMin))} {t("masjid.drive")}
                        </>
                      )}
                    </span>
                  </span>
                  <Navigation2
                    ref={(el) => setArrowRef(m.id, el)}
                    className={cn(
                      "size-4 shrink-0 text-teal",
                      !headingLive && "text-ink-faint",
                    )}
                    style={{ transform: `rotate(${bearing}deg)` }}
                    aria-hidden="true"
                  />
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-ink-faint transition-transform duration-200 motion-reduce:transition-none",
                      expanded && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>

                {expanded && (
                  <div className="flex flex-col gap-2 border-t border-border-soft/60 p-2.5">
                    {/* Rendered only while expanded: an iframe per row would
                        otherwise cost a map load for every masjid in the list. */}
                    {state.embedKey ? (
                      <iframe
                        title={t("masjid.mapTitle")}
                        src={embedUrl(m, location, state.embedKey)}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        allowFullScreen
                        className="h-48 w-full rounded-lg border-0 bg-veil/10"
                      />
                    ) : null}
                    <div className="flex items-center gap-2">
                      <a
                        href={mapsUrl(m)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="press hit-target flex-1 rounded-full border border-teal/30 bg-teal/[0.07] px-3 py-1.5 text-center text-[12px] font-semibold text-teal transition-colors hover:bg-teal/[0.12]"
                      >
                        {t("masjid.maps")}
                      </a>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
          </ul>

          {adding ? (
            <AddMasjidSheet
              lat={location.lat}
              lon={location.lon}
              onClose={() => setAdding(false)}
              onAdded={() => setMineNonce((n) => n + 1)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="press hit-target mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-ink-faint transition-colors hover:text-emerald"
            >
              <Plus className="size-3" />
              {t("masjid.addCta")}
            </button>
          )}

          {/* ODbL requires attribution wherever OpenStreetMap data is shown,
              and the resident dataset is merged into every list. */}
          <p className="text-center text-[10px] leading-4 text-ink-faint/70">
            {t("masjid.attribution")}
          </p>
        </>
      )}
    </section>
  );
}
