/**
 * Qibla math — pure great-circle geometry shared by the compass card and the
 * nearest-masjid bearing arrows (docs/QIBLA_MASJID_SPEC.md §5a). No imports,
 * works identically on web, native and offline.
 */

export const KAABA = { lat: 21.422487, lon: 39.826206 } as const;

/** Same constant as server/src/util/geo-distance.ts so values agree. */
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Initial great-circle bearing from point 1 to point 2, in degrees clockwise
 * from TRUE north, normalized to [0, 360).
 */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lon2 - lon1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Bearing to the Kaaba in degrees CW from true north. Baghdad sanity ≈ 199.8° (SSW). */
export function bearingToKaaba(lat: number, lon: number): number {
  return initialBearing(lat, lon, KAABA.lat, KAABA.lon);
}

/** Great-circle distance in km — port of server/src/util/geo-distance.ts. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distance from a point to the Kaaba in km. */
export function distanceToKaabaKm(lat: number, lon: number): number {
  return haversineKm(lat, lon, KAABA.lat, KAABA.lon);
}
