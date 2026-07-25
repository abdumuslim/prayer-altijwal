/**
 * Masjids this device has contributed (ADR-014).
 *
 * A submission is stored server-side as `pending` and only reaches everyone else
 * once a moderator approves it — but the person who added it should see it in
 * their own list straight away, or the feature feels broken. Keeping their copy
 * locally achieves that without ever serving unreviewed text to anyone else.
 */

import type { Masjid } from "@/types/api";

const KEY = "prayer.mymasjids.v1";

/** A local cap; the server enforces the real one. */
const MAX_LOCAL = 50;

interface StoredMine {
  name: string;
  lat: number;
  lon: number;
  at: number;
}

function read(): StoredMine[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return (v as StoredMine[]).filter(
      (m) =>
        typeof m?.name === "string" && Number.isFinite(m?.lat) && Number.isFinite(m?.lon),
    );
  } catch {
    return [];
  }
}

/** This device's contributions, shaped like any other masjid in the list. */
export function myMasjids(): Masjid[] {
  return read().map((m, i) => ({
    id: `usr:local-${m.at}-${i}`,
    name: m.name,
    lat: m.lat,
    lon: m.lon,
    address: null,
  }));
}

export function rememberMyMasjid(name: string, lat: number, lon: number, now = Date.now()): void {
  const next = [...read(), { name, lat, lon, at: now }].slice(-MAX_LOCAL);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or unavailable — the submission still reached the server.
  }
}

export function clearMyMasjids(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
