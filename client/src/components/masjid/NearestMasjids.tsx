// Nearest-masjid section (docs/QIBLA_MASJID_SPEC.md §6b): closest mosques
// around the user's REAL GPS position via the server-side Places proxy. Each row
// shows the name (marquee when it doesn't fit), distance + walking/driving time,
// and a live bearing arrow; TAPPING a row expands an embedded Google directions
// map with the Google Maps / Waze buttons (2026-07-22 redesign — the buttons
// used to sit in every row). Gated on a real GPS fix: searching from the Baghdad
// default would mislead (Q5). The section hides itself entirely when the server
// reports the feature disabled.
//
// Refreshes (user, 2026-07-22): on tab re-entry and on pull-to-refresh, because
// the list used to fetch once per position and then never again.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, MapPin, Navigation2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchNearbyMasjids } from "@/lib/api";
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
/**
 * Position rounding for "have we already fetched this?", matching the server's
 * ~300 m grid cache (server/src/places/cache.ts GRID_DEG = 0.003). Anything
 * finer just re-requests a response we know is identical.
 */
const GRID_DEG = 0.003;

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
  | { kind: "ready"; masjids: Masjid[]; embedKey?: string };

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

function mapsUrl(m: Masjid): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lon}&destination_place_id=${encodeURIComponent(m.id)}`;
}

function wazeUrl(m: Masjid): string {
  return `https://waze.com/ul?ll=${m.lat},${m.lon}&navigate=yes`;
}

/** Google Maps Embed API — directions from the user to this masjid. The key is
 *  the browser-safe Embed-only one the server hands us (never the Places key). */
function embedUrl(m: Masjid, from: StoredLocation, key: string): string {
  const params = new URLSearchParams({
    key,
    origin: `${from.lat},${from.lon}`,
    destination: `place_id:${m.id}`,
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
  const fetchedForRef = useRef<string | null>(null);
  const wasActiveRef = useRef(active);

  const isGpsFix = location.source === "gps";
  const { subscribe, getHeading, status: compassStatus } = compass;
  const headingLive = compassStatus === "active";

  // Returning to the tab must re-check for masjids: the position signature is
  // unchanged, so without this the dedupe below would short-circuit forever.
  if (active && !wasActiveRef.current) fetchedForRef.current = null;
  wasActiveRef.current = active;

  useEffect(() => {
    if (!active || !isGpsFix) return;
    const sig = `${Math.round(location.lat / GRID_DEG)},${Math.round(location.lon / GRID_DEG)}`;
    if (fetchedForRef.current === sig) return;
    fetchedForRef.current = sig;

    const abort = new AbortController();
    // Keep any existing list on screen while refreshing — a re-entry that blanks
    // the section then repaints it reads as a bug.
    setState((s) => (s.kind === "ready" ? s : { kind: "loading" }));
    fetchNearbyMasjids(location.lat, location.lon, abort.signal)
      .then((res) => {
        if (!res.enabled) {
          setState({ kind: "disabled" });
        } else if (res.degraded) {
          setState({ kind: "error" });
          fetchedForRef.current = null; // upstream hiccup — retry on next visit
        } else {
          setState({
            kind: "ready",
            masjids: res.masjids.slice(0, MAX_ROWS),
            embedKey: res.embedKey,
          });
        }
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setState({ kind: "error" });
        fetchedForRef.current = null;
      });
    return () => abort.abort();
  }, [active, isGpsFix, location.lat, location.lon, refreshNonce]);

  const retry = useCallback(() => {
    fetchedForRef.current = null;
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

  const masjids = state.kind === "ready" ? state.masjids : null;
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
      ) : state.masjids.length === 0 ? (
        <p className="py-2 text-center text-[12px] text-ink-dim">{t("masjid.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {state.masjids.map((m) => {
            const km = haversineKm(location.lat, location.lon, m.lat, m.lon);
            const bearing = initialBearing(location.lat, location.lon, m.lat, m.lon);
            const expanded = expandedId === m.id;
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
                      {m.walkMin != null && (
                        <> · {m.walkMin} {t(minuteUnitKey(m.walkMin))} {t("masjid.walk")}</>
                      )}
                      {m.driveMin != null && (
                        <> · {m.driveMin} {t(minuteUnitKey(m.driveMin))} {t("masjid.drive")}</>
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
                      <a
                        href={wazeUrl(m)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="press hit-target flex-1 rounded-full border border-sky/30 bg-sky/[0.07] px-3 py-1.5 text-center text-[12px] font-semibold text-sky transition-colors hover:bg-sky/[0.12]"
                      >
                        {t("masjid.waze")}
                      </a>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
