// Position lookup with typed, user-friendly errors. On the web it wraps
// navigator.geolocation; inside the Capacitor native shell it uses the
// @capacitor/geolocation plugin instead — the WebView's navigator.geolocation
// cannot obtain a fix without native runtime permission (the cause of the APK
// nearest-masjid section doing nothing — docs/QIBLA_MASJID_SPEC.md §6b). The
// plugin is imported dynamically so it never enters the web bundle.

import { isNative } from "@/lib/native";

export type GeolocationErrorKind =
  | "unsupported"
  | "denied"
  | "unavailable"
  | "timeout";

export class GeolocationFailure extends Error {
  readonly kind: GeolocationErrorKind;
  constructor(kind: GeolocationErrorKind, message: string) {
    super(message);
    this.name = "GeolocationFailure";
    this.kind = kind;
  }
}

export interface Coords {
  lat: number;
  lon: number;
  accuracy: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_AGE_MS = 5 * 60_000;

export function getCurrentPosition(options?: PositionOptions): Promise<Coords> {
  return isNative() ? getNativePosition(options) : getWebPosition(options);
}

/**
 * Is location permission ALREADY granted? Never prompts — this is what lets the
 * masjid section fetch by itself for a user who granted once, without turning a
 * tab visit into a permission dialog (opt-in stays opt-in). False on anything
 * uncertain, including browsers without the Permissions API.
 */
export async function hasGeolocationPermission(): Promise<boolean> {
  try {
    if (isNative()) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const perms = await Geolocation.checkPermissions();
      return perms.location === "granted" || perms.coarseLocation === "granted";
    }
    if (!("permissions" in navigator)) return false;
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

function getWebPosition(options?: PositionOptions): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(
        new GeolocationFailure(
          "unsupported",
          "Geolocation is not supported on this device.",
        ),
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        const kind: GeolocationErrorKind =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unavailable";
        reject(new GeolocationFailure(kind, err.message));
      },
      {
        enableHighAccuracy: false,
        timeout: DEFAULT_TIMEOUT_MS,
        maximumAge: DEFAULT_MAX_AGE_MS,
        ...options,
      },
    );
  });
}

/** Native (Capacitor) path: request the runtime location permission once — the
 *  OS remembers the grant — then read the fix. Maps plugin errors to the same
 *  GeolocationFailure kinds the web path uses so callers need no branching. */
async function getNativePosition(options?: PositionOptions): Promise<Coords> {
  const { Geolocation } = await import("@capacitor/geolocation");
  try {
    let perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
      perm = await Geolocation.requestPermissions({
        permissions: ["location", "coarseLocation"],
      });
    }
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
      throw new GeolocationFailure("denied", "Location permission denied.");
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: options?.enableHighAccuracy ?? false,
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      maximumAge: options?.maximumAge ?? DEFAULT_MAX_AGE_MS,
    });
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    };
  } catch (err) {
    if (err instanceof GeolocationFailure) throw err;
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    const kind: GeolocationErrorKind =
      msg.includes("denied") || msg.includes("permission")
        ? "denied"
        : msg.includes("timeout") || msg.includes("timed out")
          ? "timeout"
          : "unavailable";
    throw new GeolocationFailure(
      kind,
      err instanceof Error ? err.message : "Location unavailable.",
    );
  }
}

/** Best-effort device IANA timezone, used only as a weak last-resort default. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
