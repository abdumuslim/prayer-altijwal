// Typed fetch wrappers for the backend HTTP API. All endpoints are public.
// The client never imports server code — only these JSON contracts.

import type {
  CitySearchResponse,
  Lang,
  PrayerTimesResponse,
  PushPrefsBody,
  PushSubscribeBody,
  ReverseGeoResponse,
  VapidKeyResponse,
} from "@/types/api";

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
    res = await fetch(path, {
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

export function updatePushPrefs(body: PushPrefsBody): Promise<unknown> {
  return request<unknown>("/api/push/prefs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
