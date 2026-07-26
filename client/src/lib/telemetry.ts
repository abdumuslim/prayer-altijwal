import { getClientId } from "@/lib/client-id";
import { localDayKey } from "@/lib/civil-day";

/**
 * Anonymous daily audience ping (ADR-016, docs/ADMIN_DASHBOARD.md §8).
 *
 * Answers one question — how many people use the app, roughly where, on which
 * version — while storing nothing that identifies anyone:
 *
 *   - coordinates are rounded to ~1.1 km HERE, before leaving the device;
 *   - the server stores an HMAC of (day | client id) that rotates every day,
 *     never the client id itself;
 *   - the endpoint always answers 204, so nothing about it is observable.
 *
 * Structure follows the client's testing convention: all the logic lives in
 * pure exported functions covered by telemetry.test.ts, and the one effectful
 * function is a thin shell over them (client tests run in node, without a DOM).
 */

/**
 * Grid the client rounds to before sending. ~1.1 km of latitude.
 *
 * CHANGING THIS CHANGES WHAT LEAVES THE DEVICE. It is declared in the privacy
 * policy and underpins the Play Data Safety answers, so lowering it is a
 * compliance change — update client/public/privacy.html and the Data Safety
 * form in the same release, never on its own.
 */
export const TELEMETRY_PRECISION_DEG = 0.01;

const STORAGE_KEY = "prayer.telemetry.v1";
/** Long enough to stay clear of first paint, short enough to catch a quick visit. */
const SEND_DELAY_MS = 3000;
const TIMEOUT_MS = 8000;

export type TelemetryPlatform = "web" | "android" | "ios";
export type TelemetryLocSource = "default" | "gps" | "search" | "governorate";
export type TelemetryDisplayMode = "standalone" | "browser" | "native";

export interface PingInput {
  platform: TelemetryPlatform;
  appVersion: string;
  lat: number;
  lon: number;
  locSource?: TelemetryLocSource;
  tz: string;
  features: string[];
  notif: boolean;
  theme: string;
  displayMode: TelemetryDisplayMode;
}

export interface PingBody {
  platform: TelemetryPlatform;
  appVersion: string;
  lat: number;
  lon: number;
  locSource?: TelemetryLocSource;
  tz: string;
  features: string[];
  notif: boolean;
  theme: string;
  displayMode: TelemetryDisplayMode;
}

interface TelemetryState {
  lastDay?: string;
}

/** One send per local calendar day. */
export function shouldPing(lastDay: string | null | undefined, todayLocal: string): boolean {
  if (!todayLocal) return false;
  return lastDay !== todayLocal;
}

/**
 * Snap to the grid. The `toFixed` matters: `Math.round(33.3152/0.01)*0.01` is
 * 33.32000000000001 in binary floating point, and sending that would be both
 * wrong-looking and (very slightly) more precise than promised.
 */
export function roundCoord(value: number, gridDeg: number = TELEMETRY_PRECISION_DEG): number {
  if (!Number.isFinite(value)) return 0;
  const places = Math.min(10, Math.max(0, Math.ceil(-Math.log10(gridDeg))));
  return Number((Math.round(value / gridDeg) * gridDeg).toFixed(places));
}

/** Build the wire body. Coordinates are coarsened here — nowhere else. */
export function buildPingBody(input: PingInput): PingBody {
  const body: PingBody = {
    platform: input.platform,
    appVersion: input.appVersion,
    lat: roundCoord(input.lat),
    lon: roundCoord(input.lon),
    tz: input.tz,
    features: [...input.features].sort(),
    notif: input.notif,
    theme: input.theme,
    displayMode: input.displayMode,
  };
  if (input.locSource) body.locSource = input.locSource;
  return body;
}

export function readState(raw: string | null): TelemetryState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as TelemetryState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Fire-and-forget the daily ping.
 *
 * Every failure path is silent and the stored day is written ONLY after the
 * server accepts it, so a failed send simply retries on the next app open —
 * and a telemetry outage can never affect the app.
 */
export function maybeSendDailyPing(input: PingInput): void {
  // Never pollute production data from a dev server.
  if (import.meta.env.DEV) return;

  try {
    const today = localDayKey(input.tz);
    if (!shouldPing(readState(localStorage.getItem(STORAGE_KEY)).lastDay, today)) return;

    window.setTimeout(() => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);

      void fetch(pingUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Id": getClientId() },
        body: JSON.stringify(buildPingBody(input)),
        signal: controller.signal,
        keepalive: true,
      })
        .then((res) => {
          // Only a real acceptance stops us trying again today.
          if (res.ok) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ lastDay: today }));
          }
        })
        .catch(() => {
          /* offline, blocked, aborted — try again next open */
        })
        .finally(() => window.clearTimeout(timer));
    }, SEND_DELAY_MS);
  } catch {
    /* storage unavailable (private mode, quota) — telemetry is not worth an error */
  }
}

/**
 * The native app is served from https://localhost, so it needs the absolute
 * origin; the web app posts same-origin. Mirrors lib/api.ts's apiBase().
 */
function pingUrl(): string {
  const isNativeOrigin = window.location.protocol === "https:" && window.location.hostname === "localhost";
  return `${isNativeOrigin ? "https://prayer.altijwal.com" : ""}/api/telemetry/ping`;
}
