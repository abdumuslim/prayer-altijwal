// Typed fetch wrappers for the backend HTTP API. All endpoints are public.
// The client never imports server code — only these JSON contracts.

import type {
  AlertInput,
  AlertsResponse,
  CitySearchResponse,
  DeclinationResponse,
  GovernoratesResponse,
  Lang,
  MasjidsResponse,
  MonthTimesResponse,
  PrayerAlert,
  PrayerTimesResponse,
  PushSubscribeBody,
  ReverseGeoResponse,
  VapidKeyResponse,
} from "@/types/api";
import { isNative } from "@/lib/native";

// In the native (Capacitor) app the page origin is https://localhost, so API
// calls must target the deployed backend absolutely (CORS is enabled server-side
// for /api/*). On web this is "" → same-origin relative paths (dev proxy / prod).
const PROD_API_ORIGIN = "https://prayer.altijwal.com";
function apiBase(): string {
  return isNative() ? PROD_API_ORIGIN : "";
}

export class ApiRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, {
      ...init,
      signal,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new ApiRequestError("Network request failed", 0);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new ApiRequestError(message, res.status);
  }

  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export interface PrayerTimesParams {
  lat: number;
  lon: number;
  tz: string;
  method?: string;
  country?: string;
  city?: string;
  asr?: string;
  date?: string;
  elevation?: number;
  lang: Lang;
}

export function fetchPrayerTimes(
  params: PrayerTimesParams,
  signal?: AbortSignal,
): Promise<PrayerTimesResponse> {
  return request<PrayerTimesResponse>(
    `/api/prayer-times${qs({ ...params })}`,
    undefined,
    signal,
  );
}

export interface MonthTimesParams {
  lat: number;
  lon: number;
  tz: string;
  method?: string;
  country?: string;
  city?: string;
  asr?: string;
  /** YYYY-MM */
  month: string;
  elevation?: number;
  lang: Lang;
}

export function fetchMonthTimes(
  params: MonthTimesParams,
  signal?: AbortSignal,
): Promise<MonthTimesResponse> {
  return request<MonthTimesResponse>(
    `/api/prayer-times/month${qs({ ...params })}`,
    undefined,
    signal,
  );
}

export function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<ReverseGeoResponse> {
  return request<ReverseGeoResponse>(
    `/api/geo/reverse${qs({ lat, lon })}`,
    undefined,
    signal,
  );
}

export function searchCities(
  q: string,
  lang: Lang,
  signal?: AbortSignal,
): Promise<CitySearchResponse> {
  return request<CitySearchResponse>(
    `/api/geo/search${qs({ q, lang })}`,
    undefined,
    signal,
  );
}

export function fetchGovernorates(
  country: string,
  signal?: AbortSignal,
): Promise<GovernoratesResponse> {
  return request<GovernoratesResponse>(
    `/api/geo/governorates${qs({ country })}`,
    undefined,
    signal,
  );
}

export function fetchDeclination(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<DeclinationResponse> {
  return request<DeclinationResponse>(
    `/api/geo/declination${qs({ lat, lon })}`,
    undefined,
    signal,
  );
}

export function fetchNearbyMasjids(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<MasjidsResponse> {
  return request<MasjidsResponse>(
    `/api/places/masjids${qs({ lat, lon })}`,
    undefined,
    signal,
  );
}

export function fetchVapidKey(signal?: AbortSignal): Promise<VapidKeyResponse> {
  return request<VapidKeyResponse>("/api/push/vapid-key", undefined, signal);
}

export function subscribePush(body: PushSubscribeBody): Promise<unknown> {
  return request<unknown>("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function unsubscribePush(endpoint: string): Promise<unknown> {
  return request<unknown>("/api/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}

// ── Reminder rules (multiple independent alerts per device) ──────────────────

export function listAlerts(
  endpoint: string,
  signal?: AbortSignal,
): Promise<AlertsResponse> {
  return request<AlertsResponse>(
    `/api/push/alerts${qs({ endpoint })}`,
    undefined,
    signal,
  );
}

export function createAlert(body: AlertInput): Promise<{ alert: PrayerAlert }> {
  return request<{ alert: PrayerAlert }>("/api/push/alerts", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateAlert(
  id: number,
  body: AlertInput,
): Promise<{ alert: PrayerAlert }> {
  return request<{ alert: PrayerAlert }>(`/api/push/alerts/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteAlert(id: number, endpoint: string): Promise<unknown> {
  return request<unknown>(`/api/push/alerts/${id}${qs({ endpoint })}`, {
    method: "DELETE",
  });
}
