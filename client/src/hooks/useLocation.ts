// Location resolution with the FRONTEND.md fallback chain:
//   1. persisted location → render instantly
//   2. GPS → reverse-geocode → persist
//   3. (denied/unavailable) → city search (handled by caller via setLocation)
//   4. last resort → device-tz default capital
// Never blocks the UI; always overridable.

import { useCallback, useEffect, useState } from "react";
import { reverseGeocode } from "@/lib/api";
import {
  GeolocationFailure,
  deviceTimeZone,
  getCurrentPosition,
} from "@/lib/geolocation";
import { loadState, patchState, type StoredLocation } from "@/lib/storage";

export type LocationStatus =
  | "idle"
  | "loading"
  | "ready"
  | "denied"
  | "error";

export interface UseLocation {
  location: StoredLocation | null;
  /** Method detected for this location by reverse-geocode (auto default). */
  detectedMethod: string | null;
  status: LocationStatus;
  /** Whether we are still resolving the very first location. */
  resolving: boolean;
  /** Options override e.g. { enableHighAccuracy: true, maximumAge: 0 } for the
   *  nearest-masjid precise fix (docs/QIBLA_MASJID_SPEC.md §6b). */
  requestGps: (options?: PositionOptions) => Promise<void>;
  /** Two-stage fix for the masjid list — see the implementation comment. */
  requestGpsStaged: () => Promise<void>;
  setLocation: (loc: StoredLocation, detectedMethod?: string | null) => void;
  errorKind: "denied" | "unavailable" | "timeout" | "fetch" | null;
}

/** The default location: Baghdad. Shown until the user picks a city or grants
 *  GPS (opt-in via the search panel). Audience is Iraq-centric. Coordinates are
 *  the governorate-dataset Baghdad (iq-governorates.ts) — the same anchor the
 *  server's Waqf calibration is fit at, so the default open matches the official
 *  table (and the governorate quick-pick) to the minute. */
const BAGHDAD_DEFAULT: StoredLocation = {
  city: "Baghdad",
  cityAr: "بغداد",
  country: "IQ",
  tz: "Asia/Baghdad",
  lat: 33.34058,
  lon: 44.40088,
  elevation: 41,
  source: "default",
};

/** The previous default (pre-calibration). Used once to migrate stale persisted
 *  state to the new anchor so returning users get the corrected times. */
const OLD_BAGHDAD_DEFAULT = { lat: 33.3152, lon: 44.3661 } as const;

export function useLocation(): UseLocation {
  const persisted = loadState().location;
  const [location, setLocationState] = useState<StoredLocation | null>(
    persisted ?? BAGHDAD_DEFAULT,
  );
  const [detectedMethod, setDetectedMethod] = useState<string | null>(null);
  const [status, setStatus] = useState<LocationStatus>("ready");
  const [errorKind, setErrorKind] =
    useState<UseLocation["errorKind"]>(null);

  const setLocation = useCallback(
    (loc: StoredLocation, method: string | null = null) => {
      // City-search / governorate picks — stamp the source unless the caller
      // already labeled it (the masjid GPS gate keys off "gps").
      const stamped: StoredLocation = { ...loc, source: loc.source ?? "search" };
      setLocationState(stamped);
      setDetectedMethod(method);
      setStatus("ready");
      setErrorKind(null);
      patchState({ location: stamped });
    },
    [],
  );

  const requestGps = useCallback(async (options?: PositionOptions) => {
    setStatus("loading");
    setErrorKind(null);
    try {
      const coords = await getCurrentPosition(options);
      try {
        const rev = await reverseGeocode(coords.lat, coords.lon);
        const loc: StoredLocation = {
          city: rev.city,
          cityAr: rev.cityAr,
          country: rev.country,
          tz: rev.tz,
          lat: coords.lat,
          lon: coords.lon,
          elevation: rev.elevation,
          source: "gps",
        };
        setLocationState(loc);
        setDetectedMethod(rev.method ?? null);
        setStatus("ready");
        patchState({ location: loc });
      } catch {
        // Got coords but reverse lookup failed — still usable with device tz.
        const loc: StoredLocation = {
          city: null,
          country: null,
          tz: deviceTimeZone(),
          lat: coords.lat,
          lon: coords.lon,
          elevation: null,
          source: "gps",
        };
        setLocationState(loc);
        setStatus("ready");
        setErrorKind("fetch");
        patchState({ location: loc });
      }
    } catch (err) {
      const denied =
        err instanceof GeolocationFailure && err.kind === "denied";
      const kind: UseLocation["errorKind"] = denied
        ? "denied"
        : err instanceof GeolocationFailure && err.kind === "timeout"
          ? "timeout"
          : "unavailable";
      setStatus(denied ? "denied" : "error");
      setErrorKind(kind);
      // On unsupported geolocation, keep the Baghdad default rather than leaving
      // the UI empty. (Denied/timeout simply keep whatever location is shown.)
      if (!denied && err instanceof GeolocationFailure && err.kind === "unsupported") {
        setLocationState(BAGHDAD_DEFAULT);
        setDetectedMethod(null);
        patchState({ location: BAGHDAD_DEFAULT });
      }
    }
  }, []);

  /**
   * Two-stage GPS for the nearest-masjid list (user, 2026-07-22: "the masjid
   * list is slow to appear", and never appeared at all on a Galaxy A70/A21).
   *
   * A single high-accuracy, `maximumAge: 0` fix makes the user wait for a cold
   * GNSS lock — tens of seconds on a budget phone, and a hard failure at the
   * 12 s default timeout indoors. So: take a CACHED/coarse fix first (the list
   * appears within a second), then refine in the background and only re-publish
   * if the precise fix landed in a different ~300 m cell, which is the only case
   * that can change the results.
   */
  const requestGpsStaged = useCallback(async () => {
    let fast = false;
    try {
      await requestGps({
        enableHighAccuracy: false,
        maximumAge: 5 * 60_000,
        timeout: 8_000,
      });
      fast = true;
    } catch {
      // Ignored: requestGps reports its own failure; stage 2 is the real attempt.
    }
    try {
      await requestGps({
        enableHighAccuracy: true,
        maximumAge: 0,
        // Generous: this runs in the background with a usable fix already shown.
        timeout: 30_000,
      });
    } catch {
      if (!fast) throw new Error("gps unavailable");
    }
  }, [requestGps]);

  // One-time upgrade for locations persisted before Arabic names existed (no
  // `cityAr` field): backfill it (and refresh names) from a reverse lookup by the
  // stored coordinates, so the saved city shows in Arabic without re-doing GPS.
  useEffect(() => {
    if (!persisted || persisted.cityAr !== undefined) return;
    let cancelled = false;
    void reverseGeocode(persisted.lat, persisted.lon)
      .then((rev) => {
        if (cancelled) return;
        const upgraded: StoredLocation = {
          ...persisted,
          city: rev.city ?? persisted.city,
          cityAr: rev.cityAr ?? null,
          country: rev.country ?? persisted.country,
        };
        setLocationState(upgraded);
        patchState({ location: upgraded });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // run once on mount for a stale persisted location
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time migration: a location persisted at the OLD Baghdad default (before
  // the Waqf calibration anchored the default to the governorate-dataset coords)
  // is replaced with the new default so returning users see the corrected times.
  // Only the exact old default is touched — searched/GPS locations are left alone.
  useEffect(() => {
    if (
      persisted &&
      persisted.country === "IQ" &&
      persisted.city === "Baghdad" &&
      persisted.lat === OLD_BAGHDAD_DEFAULT.lat &&
      persisted.lon === OLD_BAGHDAD_DEFAULT.lon
    ) {
      setLocationState(BAGHDAD_DEFAULT);
      patchState({ location: BAGHDAD_DEFAULT });
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No auto-GPS prompt: the app opens on the Baghdad default; GPS is opt-in via
  // the "Use my location" button in the search panel.

  return {
    location,
    detectedMethod,
    status,
    resolving: status === "loading",
    requestGps,
    requestGpsStaged,
    setLocation,
    errorKind,
  };
}
