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
import { runStagedFix } from "@/lib/gps-staging";

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
  /** Resolves to whether a usable GPS fix was obtained (never rejects). */
  requestGps: (options?: PositionOptions, opts?: { silent?: boolean }) => Promise<boolean>;
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

  const requestGps = useCallback(
    async (options?: PositionOptions, opts?: { silent?: boolean }): Promise<boolean> => {
      // A silent call is the background PRECISE refine (gps-staging.ts): it may
      // upgrade the fix on success but must never show a spinner or an error, so
      // a slow/failed high-accuracy lock can't flash over a list already painted
      // from a coarse fix (docs/QIBLA_MASJID_SPEC.md — the false-error bug).
      // Returns whether a usable GPS fix was obtained — the staging keys off this,
      // never a rejection (this function reports failures via UI state instead).
      const silent = opts?.silent ?? false;
      if (!silent) {
        setStatus("loading");
        setErrorKind(null);
      }
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
          if (!silent) setStatus("ready");
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
          if (!silent) {
            setStatus("ready");
            setErrorKind("fetch");
          }
          patchState({ location: loc });
        }
        return true; // a GPS fix landed (source: "gps") even if reverse failed
      } catch (err) {
        // Failure: a silent refine keeps whatever fix is already shown; a
        // non-silent attempt surfaces the typed error. Either way, report no fix.
        if (!silent) {
          const denied =
            err instanceof GeolocationFailure && err.kind === "denied";
          const kind: UseLocation["errorKind"] = denied
            ? "denied"
            : err instanceof GeolocationFailure && err.kind === "timeout"
              ? "timeout"
              : "unavailable";
          setStatus(denied ? "denied" : "error");
          setErrorKind(kind);
          // On unsupported geolocation, keep the Baghdad default rather than
          // leaving the UI empty. (Denied/timeout keep whatever is shown.)
          if (!denied && err instanceof GeolocationFailure && err.kind === "unsupported") {
            setLocationState(BAGHDAD_DEFAULT);
            setDetectedMethod(null);
            patchState({ location: BAGHDAD_DEFAULT });
          }
        }
        return false;
      }
    },
    [],
  );

  /**
   * Staged GPS for the nearest-masjid list (user, 2026-07-22: "the masjid list
   * is slow to appear", and never appeared at all on a Galaxy A70/A21; 2026-07-24:
   * an intermittent cold-fix failure showed an error instead of the list).
   *
   * A single high-accuracy, `maximumAge: 0` fix makes the user wait for a cold
   * GNSS lock — tens of seconds on a budget phone, a hard failure indoors. So the
   * orchestration (lib/gps-staging.ts, unit-tested): paint from the LAST KNOWN
   * position first, fall back patiently on a cold device, and refine precisely in
   * the background — SILENTLY, so a slow refine never flashes an error over a list
   * that is already correct.
   */
  const requestGpsStaged = useCallback(
    () => runStagedFix((options, opts) => requestGps(options, opts)),
    [requestGps],
  );

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
