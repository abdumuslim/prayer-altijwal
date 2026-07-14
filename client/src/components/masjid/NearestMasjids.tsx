// Nearest-masjid section (docs/QIBLA_MASJID_SPEC.md §6b): closest mosques
// around the user's REAL GPS position via the server-side Places proxy, each
// with distance, a live qibla-style bearing arrow (reusing the shared compass
// state when active) and Google Maps / Waze navigation deep links. Gated on a
// real GPS fix — searching from the Baghdad default would mislead (Q5). The
// section hides itself entirely when the server reports the feature disabled.

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Navigation2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchNearbyMasjids } from "@/lib/api";
import { haversineKm, initialBearing } from "@/lib/qibla";
import { cn } from "@/lib/utils";
import { MosqueIcon } from "@/components/ui/MosqueIcon";
import type { UseCompassHeading } from "@/hooks/useCompassHeading";
import type { StoredLocation } from "@/lib/storage";
import type { Masjid } from "@/types/api";

const MAX_ROWS = 5;

interface NearestMasjidsProps {
  location: StoredLocation;
  /** Times-tab visibility (keep-mounted tabs) — nothing fetches while hidden. */
  active: boolean;
  /** Shared heading state from TimesPage — live-rotates the row arrows. */
  compass: UseCompassHeading;
  /** High-accuracy GPS opt-in (useLocation.requestGps with overrides). */
  onUseGps: () => void;
  resolving: boolean;
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "disabled" }
  | { kind: "ready"; masjids: Masjid[] };

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} م`;
  return `${km.toFixed(1)} كم`;
}

function mapsUrl(m: Masjid): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${m.lat},${m.lon}&destination_place_id=${encodeURIComponent(m.id)}`;
}

function wazeUrl(m: Masjid): string {
  return `https://waze.com/ul?ll=${m.lat},${m.lon}&navigate=yes`;
}

export function NearestMasjids({ location, active, compass, onUseGps, resolving }: NearestMasjidsProps) {
  const { t } = useI18n();
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const fetchedForRef = useRef<string | null>(null);

  const isGpsFix = location.source === "gps";
  const heading = compass.status === "active" ? compass.trueHeading : null;

  useEffect(() => {
    if (!active || !isGpsFix) return;
    const sig = `${location.lat.toFixed(4)},${location.lon.toFixed(4)}`;
    if (fetchedForRef.current === sig) return;
    fetchedForRef.current = sig;

    const abort = new AbortController();
    setState({ kind: "loading" });
    fetchNearbyMasjids(location.lat, location.lon, abort.signal)
      .then((res) => {
        if (!res.enabled) {
          setState({ kind: "disabled" });
        } else if (res.degraded) {
          setState({ kind: "error" });
          fetchedForRef.current = null; // upstream hiccup — retry on next visit
        } else {
          setState({ kind: "ready", masjids: res.masjids.slice(0, MAX_ROWS) });
        }
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setState({ kind: "error" });
        fetchedForRef.current = null;
      });
    return () => abort.abort();
  }, [active, isGpsFix, location.lat, location.lon]);

  // Server says no key configured — the feature doesn't exist for this deploy.
  if (state.kind === "disabled") return null;

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink-dim">
        <MosqueIcon className="size-4 text-emerald" />
        {t("masjid.title")}
      </h2>

      {!isGpsFix ? (
        <div className="flex flex-col items-center gap-2.5 py-1">
          <p className="text-center text-[12px] leading-5 text-ink-dim">
            {t("masjid.gpsPrompt")}
          </p>
          <button
            type="button"
            onClick={onUseGps}
            className="flex items-center justify-center gap-2 rounded-xl border border-emerald/30 bg-emerald/[0.07] px-4 py-2.5 text-sm font-semibold text-emerald transition-colors hover:bg-emerald/[0.12]"
          >
            {resolving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MapPin className="size-4" />
            )}
            {t("masjid.gpsButton")}
          </button>
        </div>
      ) : state.kind === "loading" || state.kind === "idle" ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-veil" />
          ))}
        </div>
      ) : state.kind === "error" ? (
        <p className="py-2 text-center text-[12px] text-imminent/80">{t("masjid.error")}</p>
      ) : state.masjids.length === 0 ? (
        <p className="py-2 text-center text-[12px] text-ink-dim">{t("masjid.none")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {state.masjids.map((m) => {
            const km = haversineKm(location.lat, location.lon, m.lat, m.lon);
            const bearing = initialBearing(location.lat, location.lon, m.lat, m.lon);
            const arrowDeg = heading != null ? bearing - heading : bearing;
            return (
              <li
                key={m.id}
                className="flex items-center gap-2.5 rounded-xl border border-border-soft/60 bg-veil/[0.02] px-2.5 py-2"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald/10 text-emerald">
                  <MosqueIcon className="size-4.5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[13px] font-semibold text-ink">{m.name}</span>
                  <span className="tnum text-[11px] text-ink-faint">{formatDistance(km)}</span>
                </span>
                <Navigation2
                  className={cn(
                    "size-4 shrink-0 text-teal transition-transform duration-150 ease-linear motion-reduce:transition-none",
                    heading == null && "text-ink-faint",
                  )}
                  style={{ transform: `rotate(${arrowDeg}deg)` }}
                  aria-hidden="true"
                />
                <span className="flex shrink-0 items-center gap-1">
                  <a
                    href={mapsUrl(m)}
                    target="_blank"
                    rel="noopener"
                    className="rounded-full border border-teal/30 bg-teal/[0.07] px-2 py-1 text-[10px] font-semibold text-teal transition-colors hover:bg-teal/[0.12]"
                  >
                    {t("masjid.maps")}
                  </a>
                  <a
                    href={wazeUrl(m)}
                    target="_blank"
                    rel="noopener"
                    className="rounded-full border border-sky/30 bg-sky/[0.07] px-2 py-1 text-[10px] font-semibold text-sky transition-colors hover:bg-sky/[0.12]"
                  >
                    {t("masjid.waze")}
                  </a>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
