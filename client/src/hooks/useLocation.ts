// Location resolution with the FRONTEND.md fallback chain:
//   1. persisted location → render instantly
//   2. GPS → reverse-geocode → persist
//   3. (denied/unavailable) → city search (handled by caller via setLocation)
//   4. last resort → device-tz default capital
// Never blocks the UI; always overridable.

import { useCallback, useEffect, useRef, useState } from "react";
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

/** A weak last-resort default so a denied/unsupported first run still renders. */
function fallbackForDeviceTz(): StoredLocation {
  const tz = deviceTimeZone();
  // Minimal capital map keyed by common IANA zones; everything else → Mecca.
  const CAPITALS: Record<string, StoredLocation> = {
    "Asia/Baghdad": { city: "Baghdad", country: "IQ", tz: "Asia/Baghdad", lat: 33.3152, lon: 44.3661, elevation: 34 },
    "Asia/Riyadh": { city: "Riyadh", country: "SA", tz: "Asia/Riyadh", lat: 24.7136, lon: 46.6753, elevation: 612 },
    "Asia/Dubai": { city: "Dubai", country: "AE", tz: "Asia/Dubai", lat: 25.2048, lon: 55.2708, elevation: 5 },
    "Africa/Cairo": { city: "Cairo", country: "EG", tz: "Africa/Cairo", lat: 30.0444, lon: 31.2357, elevation: 23 },
    "Europe/Istanbul": { city: "Istanbul", country: "TR", tz: "Europe/Istanbul", lat: 41.0082, lon: 28.9784, elevation: 40 },
    "America/New_York": { city: "New York", country: "US", tz: "America/New_York", lat: 40.7128, lon: -74.006, elevation: 10 },
    "Europe/London": { city: "London", country: "GB", tz: "Europe/London", lat: 51.5074, lon: -0.1278, elevation: 11 },
  };
  return (
    CAPITALS[tz] ?? {
      city: "Mecca",
      country: "SA",
      tz: "Asia/Riyadh",
      lat: 21.4225,
      lon: 39.8262,
      elevation: 277,
    }
  );
}

export function useLocation(): UseLocation {
  const persisted = loadState().location;
  const [location, setLocationState] = useState<StoredLocation | null>(persisted);
  const [detectedMethod, setDetectedMethod] = useState<string | null>(null);
  const [status, setStatus] = useState<LocationStatus>(
    persisted ? "ready" : "idle",
  );
  const [errorKind, setErrorKind] =
    useState<UseLocation["errorKind"]>(null);
  const triedFirstRun = useRef(false);

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
      // Last-resort seed (FRONTEND.md step 4): when geolocation is unsupported
      // or unavailable (NOT explicitly denied), drop the user onto a sensible
      // device-tz capital so the UI always renders. Denial instead prompts the
      // city search, which is the more respectful affordance.
      if (!denied && err instanceof GeolocationFailure && err.kind === "unsupported") {
        const fallback = fallbackForDeviceTz();
        setLocationState(fallback);
        setDetectedMethod(null);
        patchState({ location: fallback });
      }
    }
  }, []);

  // First run with nothing persisted: try GPS once automatically; if it fails
  // we fall back to a device-tz capital so the UI always has something to show.
  useEffect(() => {
    if (persisted || triedFirstRun.current) return;
    triedFirstRun.current = true;
    void (async () => {
      await requestGps();
    })();
    // requestGps/persisted are stable for this one-shot effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    location,
    detectedMethod,
    status,
    resolving: !location && (status === "loading" || status === "idle"),
    requestGps,
    setLocation,
    errorKind,
  };
}
