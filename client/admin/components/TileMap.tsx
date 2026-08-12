import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Weighted points on a real OpenStreetMap basemap.
 *
 * Replaces the earlier tile-less SVG `ScatterMap` (removed 2026-07-26). That
 * version plotted circles on the bare panel background, which read as a broken
 * map, and because it auto-fitted its bounds to the data extremes, a handful of
 * sparse cells were pinned to the corners with a void in the middle. At ~1 km
 * resolution the whole question is *which neighbourhood*, and that needs streets
 * behind the circles — relative position alone does not answer it.
 *
 * Trade accepted deliberately (owner's call, 2026-07-26): this is the only
 * third-party request on the operator surface, so the admin CSP `img-src` names
 * the OSM tile hosts explicitly (see `server/src/app.ts`). Tiles are <img>
 * loads, so `connect-src` stays `'self'`. Leaflet is bundled, not CDN-loaded,
 * and the admin bundle never reaches the APK (`ADMIN_DASHBOARD.md` §1).
 *
 * Two Leaflet details worth knowing before editing:
 *   - We draw `circleMarker`s, never `Marker`s, so Leaflet's default pin PNGs
 *     are never requested. That sidesteps the classic bundler icon-path break.
 *   - `scrollWheelZoom` is off on purpose: the map sits mid-page, and grabbing
 *     the wheel would trap someone scrolling past it. Buttons + double-click
 *     still zoom.
 *
 * OSM's tile policy requires visible attribution — Leaflet renders it, and
 * `admin.css` keeps it legible against the dark theme rather than dimming it away.
 */

export interface MapPoint {
  lat: number;
  lon: number;
  n: number;
  label?: string;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// A 1 km cell is a neighbourhood, not a building — going deeper implies
// precision the data does not have, and would invite reading a cell centre as
// somebody's address.
const MAX_ZOOM = 13;

export function TileMap({
  points,
  unitLabel,
  height = 320,
  emptyLabel = "No demand recorded yet.",
}: {
  points: MapPoint[];
  unitLabel: string;
  height?: number;
  emptyLabel?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Create the map once. Points are synced separately so that new data pans
  // the existing map instead of tearing down and refetching every tile.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      scrollWheelZoom: false,
      attributionControl: true,
      zoomSnap: 0.5,
    });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    // Somewhere sensible before the first fitBounds: the app's default city.
    map.setView([33.3152, 44.3661], 10);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || points.length === 0) return;

    layer.clearLayers();
    const maxN = Math.max(...points.map((p) => p.n), 1);

    for (const p of points) {
      // Area, not radius, tracks the count — a radius-linear circle overstates
      // big cells by the square.
      L.circleMarker([p.lat, p.lon], {
        radius: 4 + 10 * Math.sqrt(p.n / maxN),
        color: "#2dd4bf",
        weight: 1.5,
        opacity: 0.9,
        fillColor: "#2dd4bf",
        fillOpacity: 0.35,
      })
        .bindTooltip(`${p.lat.toFixed(2)}, ${p.lon.toFixed(2)} — ${p.n}`)
        .addTo(layer);
    }

    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number])), {
      padding: [28, 28],
      maxZoom: MAX_ZOOM,
    });
  }, [points]);

  if (points.length === 0)
    return <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p>;

  const top = points
    .slice()
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  return (
    <figure className="m-0">
      <div
        ref={hostRef}
        className="tilemap rounded-lg border border-line"
        style={{ height }}
        role="group"
        aria-label={`Map: ${unitLabel}`}
      />
      {/* The map itself conveys nothing to a screen reader, so the same data is
          available as text. Kept short — the pages that need the full ranking
          already render it as a labelled bar list underneath. */}
      <p className="sr-only">
        {unitLabel}. Highest cells:{" "}
        {top.map((p) => `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}: ${p.n}`).join("; ")}.
      </p>
      <figcaption className="mt-1 text-[11px] text-muted">
        {unitLabel} · circle area ∝ value · OpenStreetMap
      </figcaption>
    </figure>
  );
}
