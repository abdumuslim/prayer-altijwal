import geomagnetism from "geomagnetism";

/**
 * Magnetic declination in degrees (positive east of true north) from the
 * bundled World Magnetic Model — v0.2.0 carries WMM-2025, valid into 2029.
 * `allowOutOfBoundsModel` degrades to the nearest model outside its validity
 * window instead of throwing: stale declination beats none — it drifts only
 * ~0.1°/yr (docs/QIBLA_MASJID_SPEC.md Q6).
 */
export function declinationDeg(
  lat: number,
  lon: number,
  date: Date = new Date(),
  altKm = 0,
): number {
  const info = geomagnetism.model(date, { allowOutOfBoundsModel: true }).point([lat, lon, altKm]);
  return info.decl;
}
