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
};
