// Iraq bounding box: the single source of truth for "is this coordinate inside
// the masjid service area". The nearest-masjid feature is Iraq-only (owner
// decision 2026-08-26, docs/QIBLA_MASJID_SPEC.md): the resident dataset is built
// for exactly this box (scripts/build-masjids.mjs), so answering outside it would
// mean ungoverned Google spend for a country the dataset cannot serve. The server
// geofence (places/routes.ts) and the client section gating both key off these
// numbers.
//
// The box is a little wider than Iraq's borders on purpose, so it keeps masjids
// just across the frontier, which are the right answer for someone in a border
// town. These values MUST match scripts/build-masjids.mjs BBOX.

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Bounding box covering Iraq. Mirrored by scripts/build-masjids.mjs BBOX. */
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
