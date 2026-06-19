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
  requestGps: () => Promise<void>;
  setLocation: (loc: StoredLocation, detectedMethod?: string | null) => void;
  errorKind: "denied" | "unavailable" | "timeout" | "fetch" | null;
}

/** The default location: Baghdad. Shown until the user picks a city or grants
 *  GPS (opt-in via the search panel). Audience is Iraq-centric. */
const BAGHDAD_DEFAULT: StoredLocation = {
  city: "Baghdad",
  cityAr: "بغداد",
  country: "IQ",
  tz: "Asia/Baghdad",
  lat: 33.3152,
  lon: 44.3661,
  elevation: 34,
};

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
      setLocationState(loc);
      setDetectedMethod(method);
      setStatus("ready");
      setErrorKind(null);
      patchState({ location: loc });
    },
    [],
  );

  const requestGps = useCallback(async () => {
    setStatus("loading");
    setErrorKind(null);
    try {
      const coords = await getCurrentPosition();
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

  // No auto-GPS prompt: the app opens on the Baghdad default; GPS is opt-in via
  // the "Use my location" button in the search panel.

  return {
    location,
    detectedMethod,
    status,
    resolving: status === "loading",
    requestGps,
    setLocation,
    errorKind,
  };
}
