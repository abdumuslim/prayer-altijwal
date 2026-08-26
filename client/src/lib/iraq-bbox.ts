// Iraq bounding box: the single source of truth for "is this location inside
// the masjid service area". The nearest-masjid feature is Iraq-only (owner
// decision 2026-08-26, docs/QIBLA_MASJID_SPEC.md): the resident dataset is
// Iraq-only, so the section is hidden for any location outside this box while
// the qibla compass and everything else stays for all locations.
//
// These numbers MIRROR the server constant (server/src/places/iraq-bbox.ts):
// the client cannot import server code, so they are duplicated deliberately and
// must be kept identical. The server enforces the same geofence, so a stale copy
// here can never cause Google spend; it only decides whether the UI shows the
// section. The box is a little wider than Iraq's borders on purpose so a
// border-town user still sees masjids just across the frontier.

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Bounding box covering Iraq. Mirrors server/src/places/iraq-bbox.ts IRAQ_BBOX. */
export const IRAQ_BBOX: Bbox = { south: 28.9, west: 38.6, north: 37.5, east: 48.9 };

/** True when a coordinate falls within the Iraq bounding box. */
export function isInIraqBbox(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= IRAQ_BBOX.south &&
    lat <= IRAQ_BBOX.north &&
    lon >= IRAQ_BBOX.west &&
    lon <= IRAQ_BBOX.east
  );
}
