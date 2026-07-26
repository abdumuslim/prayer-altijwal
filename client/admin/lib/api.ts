/**
 * Admin API client. Same-origin only: the server mounts /api/admin ahead of the
 * public CORS middleware, so this never works from another origin — which is
 * the point.
 */

export class AdminApiError extends Error {
  // Declared explicitly rather than as constructor parameter properties: the
  // client tsconfig sets `erasableSyntaxOnly`, which forbids that shorthand.
  readonly status: number;
  readonly retryAfterSec: number | undefined;

  constructor(message: string, status: number, retryAfterSec?: number) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Notified whenever the server rejects our session, so the shell can log out. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler = () => {};
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    // Required by the server on every write: a cross-site form or <img> cannot
    // set a custom header, so this closes CSRF alongside SameSite=Strict.
    headers.set("X-Admin-Request", "1");
    if (init?.body) headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new AdminApiError("Network request failed", 0);
  }

  if (res.status === 401) {
    onUnauthorized();
    throw new AdminApiError("Unauthorized", 401);
  }
  if (!res.ok) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new AdminApiError(message, res.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── shapes returned by the server (field-whitelisted there) ─────────────────

export interface Overview {
  server: {
    version: string;
    nodeVersion: string;
    uptimeSec: number;
    rssMb: number;
    env: string;
    startedAt: string;
  };
  db: { status: "up" | "down" | "disabled"; latencyMs: number };
  counts: {
    subscriptions: number;
    alertRules: number;
    contributionsPending: number;
    contributionsTotal: number;
    masjidsResident: number;
    masjidsCommunity: number;
  };
  scheduler: {
    running: boolean;
    lastTickAt: string | null;
    lastTickMs: number | null;
    sentToday: number;
    failedToday: number;
    goneRemovedToday: number;
  } | null;
  places: {
    billingDay: string;
    monthlyCap: number;
    usedThisMonth: number;
    activeClients: number;
    dailyPool: number;
    reserve: number;
    perClientCap: number;
    perIpCap: number;
  } | null;
  /** Averages of daily actives — NOT unique users (the install hash rotates daily). */
  audience: { activeToday: number; activeYesterday: number; avg7d: number; avg30d: number };
  flags: { placesEnabled: boolean; pushEnabled: boolean; telemetryEnabled: boolean };
  embedKey: string | null;
}

export type ContributionStatus = "pending" | "approved" | "rejected";

export interface Contribution {
  id: number;
  name: string;
  lat: number;
  lon: number;
  status: ContributionStatus;
  createdAt: string;
  /** First 8 characters of the anonymous client id — never the whole thing. */
  clientShort: string | null;
  nearest: { name: string; distanceM: number } | null;
  duplicate: boolean;
}

export interface ContributionList {
  total: number;
  counts: Record<ContributionStatus, number>;
  enabled: boolean;
  items: Contribution[];
}

export interface ContributionEdit {
  status?: ContributionStatus;
  name?: string;
  lat?: number;
  lon?: number;
}

export interface OutcomeBucket {
  key: string;
  outcomes: Record<string, number>;
  units: number;
  total: number;
}

export interface PlacesStats {
  outcomes: string[];
  billingDay: string;
  billingMonth: string;
  daily: OutcomeBucket[];
  hourlyToday: OutcomeBucket[];
  plan: {
    monthlyCap: number;
    usedThisMonth: number;
    activeClients: number;
    dailyPool: number;
    reserve: number;
    perClientCap: number;
    perIpCap: number;
  } | null;
}

export interface TopClient {
  scopeShort: string;
  requests: number;
  spend: number;
  lastSeen: string;
}

export interface DemandCell {
  cellKey: string;
  lat: number;
  lon: number;
  n: number;
  misses: number;
}

export interface Subscriber {
  id: number;
  endpointHost: string;
  country: string | null;
  tz: string | null;
  lat: number | null;
  lon: number | null;
  lang: string | null;
  rules: number;
  createdAt: string;
  updatedAt: string;
}

export interface PushSummary {
  enabled: boolean;
  subscriptions: {
    total: number;
    byCountry: { key: string; n: number }[];
    byTz: { key: string; n: number }[];
    newPerDay: { day: string; n: number }[];
  };
  rules: {
    total: number;
    byPrayer: { key: string; n: number }[];
    byKind: { key: string; n: number }[];
    byTiming: { key: string; n: number }[];
  };
  sends: { day: string; sent: number; failed: number; gone: number }[];
  subscribers: Subscriber[];
}

export interface LogEntry {
  at: string;
  level: "warn" | "error" | "fatal";
  component: string;
  msg: string;
  err?: string;
}

export interface SettingsValues {
  placesEnabled: boolean;
  placesTravelEnabled: boolean;
  placesMonthlyUnitCap: number;
  telemetryEnabled: boolean;
}

export interface SettingsResponse {
  values: SettingsValues;
  /** Whether each value comes from the database override or the env default. */
  sources: Record<keyof SettingsValues, "db" | "env">;
  defaults: SettingsValues;
  writable: boolean;
}

export interface AuditRow {
  id: number;
  at: string;
  actorIp: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
}

export const api = {
  login: (password: string) =>
    request<void>("/api/admin/session", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<void>("/api/admin/session", { method: "DELETE" }),
  session: () => request<{ ok: true; expiresAt: string | null }>("/api/admin/session"),
  overview: () => request<Overview>("/api/admin/overview"),

  contributions: (status: ContributionStatus) =>
    request<ContributionList>(`/api/admin/masjids/contributions?status=${status}`),
  moderate: (id: number, edit: ContributionEdit) =>
    request<{ ok: true; item: Contribution; liveCount: number | null }>(
      `/api/admin/masjids/contributions/${id}`,
      { method: "PATCH", body: JSON.stringify(edit) },
    ),

  placesStats: (days: number) => request<PlacesStats>(`/api/admin/places/stats?days=${days}`),
  topClients: (days: number, limit = 25) =>
    request<{ items: TopClient[] }>(`/api/admin/places/top-clients?days=${days}&limit=${limit}`),
  demand: (days: number, limit = 500) =>
    request<{ items: DemandCell[] }>(`/api/admin/places/demand?days=${days}&limit=${limit}`),

  pushSummary: (days: number) => request<PushSummary>(`/api/admin/push/summary?days=${days}`),
  deleteSubscription: (id: number) =>
    request<void>(`/api/admin/push/subscriptions/${id}`, { method: "DELETE" }),

  logs: (level: "warn" | "error", component?: string) =>
    request<{ capacity: number; components: string[]; items: LogEntry[] }>(
      `/api/admin/logs?level=${level}${component ? `&component=${encodeURIComponent(component)}` : ""}`,
    ),

  settings: () => request<SettingsResponse>("/api/admin/settings"),
  updateSettings: (patch: Partial<SettingsValues>) =>
    request<{ ok: true; values: SettingsValues; sources: SettingsResponse["sources"] }>(
      "/api/admin/settings",
      { method: "PUT", body: JSON.stringify(patch) },
    ),
  resetSetting: (name: keyof SettingsValues) =>
    request<{ ok: true; values: SettingsValues; sources: SettingsResponse["sources"] }>(
      `/api/admin/settings/${name}`,
      { method: "DELETE" },
    ),

  audit: (limit = 100) => request<{ items: AuditRow[] }>(`/api/admin/audit?limit=${limit}`),
};
