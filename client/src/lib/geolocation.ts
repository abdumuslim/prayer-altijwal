// Promise wrapper around navigator.geolocation with typed, user-friendly errors.

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

export function getCurrentPosition(
  options?: PositionOptions,
): Promise<Coords> {
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
        timeout: 12_000,
        maximumAge: 5 * 60_000,
        ...options,
      },
    );
  });
}

/** Best-effort device IANA timezone, used only as a weak last-resort default. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
