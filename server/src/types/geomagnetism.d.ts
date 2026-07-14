/**
 * Minimal typings for the `geomagnetism` package (CJS, no bundled types).
 * v0.2.0 bundles WMM-2025 (valid into 2029) and picks the model by date.
 * Only the surface we use is typed.
 */
declare module "geomagnetism" {
  interface MagneticElements {
    /** Magnetic declination in degrees, positive east of true north. */
    decl: number;
    /** Magnetic inclination (dip) in degrees. */
    incl: number;
  }

  interface GeomagModel {
    /** [lat, lon] or [lat, lon, altitudeKm above the ellipsoid]. */
    point(coords: [number, number] | [number, number, number]): MagneticElements;
  }

  const geomagnetism: {
    model(date?: Date, options?: { allowOutOfBoundsModel?: boolean }): GeomagModel;
  };
  export = geomagnetism;
}
