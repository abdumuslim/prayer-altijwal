import { childLogger } from "../logger.js";
import { RouteMatrixElements } from "../validation/places.js";

/** Any point with coordinates — a Masjid satisfies this structurally. */
export interface RoutePoint {
  lat: number;
  lon: number;
}

const log = childLogger("places/routes-api");

const ENDPOINT = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const TIMEOUT_MS = 5000;
// Billed by field mask — ask for the duration and nothing else we don't render.
const FIELD_MASK = "originIndex,destinationIndex,duration,condition";

/** Travel time to one masjid, in whole minutes; null when Google has no route. */
export interface TravelMinutes {
  walkMin: number | null;
  driveMin: number | null;
}

type TravelMode = "WALK" | "DRIVE";

/** Routes API durations are protobuf strings like "160s". */
function parseMinutes(duration: unknown): number | null {
  if (typeof duration !== "string") return null;
  const seconds = Number(duration.replace(/s$/, ""));
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.max(1, Math.round(seconds / 60)); // "0 min away" reads as broken
}

async function computeMatrix(
  origin: RoutePoint,
  masjids: RoutePoint[],
  apiKey: string,
  mode: TravelMode,
): Promise<Array<number | null> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origins: [
          {
            waypoint: {
              location: { latLng: { latitude: origin.lat, longitude: origin.lon } },
            },
          },
        ],
        destinations: masjids.map((m) => ({
          waypoint: { location: { latLng: { latitude: m.lat, longitude: m.lon } } },
        })),
        // routingPreference is DRIVE-only; sending it with WALK is a 400.
        travelMode: mode,
      }),
    });
    if (!res.ok) {
      log.warn("routes non-ok response", { status: res.status, mode });
      return null;
    }
    const parsed = RouteMatrixElements.safeParse(await res.json());
    if (!parsed.success) {
      log.warn("routes response failed validation", { mode });
      return null;
    }
    const minutes: Array<number | null> = masjids.map(() => null);
    for (const el of parsed.data) {
      if (el.condition !== "ROUTE_EXISTS") continue;
      if (el.destinationIndex < 0 || el.destinationIndex >= masjids.length) continue;
      minutes[el.destinationIndex] = parseMinutes(el.duration);
    }
    return minutes;
  } catch (err) {
    log.warn("routes matrix failed", err instanceof Error ? err : new Error(String(err)));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walking + driving travel times from the user to each masjid (Routes API
 * computeRouteMatrix — the current API; Distance Matrix is legacy).
 *
 * travelMode is per REQUEST, so this costs two upstream calls; both are counted
 * by the caller's budget breaker. Never throws: returns `null` when neither mode
 * could be fetched, and per-leg nulls otherwise, because travel times are an
 * enhancement — a masjid list without them is still correct.
 *
 * Since ADR-014 this is called with a SINGLE destination, on demand, when the
 * user expands a masjid row — not eagerly for the whole list. A 1×1 matrix is
 * valid (the API caps only the origins×destinations product) and bills 1 element
 * per mode.
 */
export async function fetchTravelMinutes(
  origin: RoutePoint,
  masjids: RoutePoint[],
  apiKey: string,
): Promise<TravelMinutes[] | null> {
  if (masjids.length === 0) return [];
  const [walk, drive] = await Promise.all([
    computeMatrix(origin, masjids, apiKey, "WALK"),
    computeMatrix(origin, masjids, apiKey, "DRIVE"),
  ]);
  if (walk === null && drive === null) return null;
  return masjids.map((_, i) => ({
    walkMin: walk?.[i] ?? null,
    driveMin: drive?.[i] ?? null,
  }));
}
