/**
 * Client-side cache for the nearest-masjid list (ADR-014).
 *
 * Two jobs:
 *  1. Skip the request entirely when the user re-opens the app in the same
 *     neighbourhood — the masjids around you do not move, so re-asking costs a
 *     round trip (and potentially a Google call) for an identical answer.
 *  2. Give the native app something to show with no network at all.
 *
 * Deliberately NOT part of `prayer.app.v1`: that envelope is user settings, read
 * and rewritten constantly, and a list of masjids has no business riding along
 * with it.
 */

import type { Masjid } from "@/types/api";

const KEY = "prayer.masjids.v1";

/** Must match the server's CELL_DEG (server/src/places/cache.ts). */
const CELL_DEG = 0.01;

/** Inside this window a same-cell entry is served with NO request at all. */
export const CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Past this the entry is dropped. Matches the server's 30-day retention: Google's
 * terms cap cached Places content at 30 days, and a copy sitting in a phone's
 * localStorage is still a copy.
 */
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedList {
  cell: string;
  at: number;
  masjids: Masjid[];
  embedKey?: string;
}

export interface CachedMasjids {
  masjids: Masjid[];
  embedKey?: string;
  ageMs: number;
  /** The entry was stored for the cell the caller is standing in now. */
  sameCell: boolean;
  /** Same cell AND recent enough to serve without asking the server. */
  fresh: boolean;
}

/** Cell key for a position — the same grid the server caches on. */
export function cellOf(lat: number, lon: number): string {
  return `${Math.round(lat / CELL_DEG)},${Math.round(lon / CELL_DEG)}`;
}

function parse(raw: string | null): CachedList | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null) return null;
    const c = v as CachedList;
    if (typeof c.cell !== "string" || typeof c.at !== "number") return null;
    if (!Array.isArray(c.masjids)) return null;
    return c;
  } catch {
    return null;
  }
}

/**
 * Last stored list, or null when there is nothing usable. Returns entries from
 * OTHER cells too (flagged `sameCell: false`) — when the network is down, the
 * list from the neighbourhood you were in an hour ago beats an empty screen.
 */
export function readMasjidCache(lat: number, lon: number, now = Date.now()): CachedMasjids | null {
  let entry: CachedList | null;
  try {
    entry = parse(localStorage.getItem(KEY));
  } catch {
    return null; // private mode / storage disabled
  }
  if (!entry) return null;

  const ageMs = now - entry.at;
  if (ageMs < 0 || ageMs > CACHE_MAX_AGE_MS) {
    clearMasjidCache();
    return null;
  }

  const sameCell = entry.cell === cellOf(lat, lon);
  return {
    masjids: entry.masjids,
    embedKey: entry.embedKey,
    ageMs,
    sameCell,
    fresh: sameCell && ageMs < CACHE_FRESH_MS,
  };
}

export function writeMasjidCache(
  lat: number,
  lon: number,
  masjids: Masjid[],
  embedKey?: string,
  now = Date.now(),
): void {
  // An empty result is a legitimate answer ("no masjids within 5 km"), but it is
  // not worth suppressing a future request over.
  if (masjids.length === 0) return;
  const entry: CachedList = { cell: cellOf(lat, lon), at: now, masjids, embedKey };
  try {
    localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Quota or private mode — the cache is an optimisation, never a requirement.
  }
}

export function clearMasjidCache(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
