// Client-side magnetic-declination cache for the WEB compass paths (the native
// path computes declination on-device via Android's GeomagneticField).
// Cached in localStorage keyed by a ~10 km grid — declination changes slowly in
// space and time, so a stale value beats none and offline reuse is fine
// (docs/QIBLA_MASJID_SPEC.md §5c).

import { fetchDeclination } from "@/lib/api";

const STORAGE_KEY = "prayer.declination.v1";

/** ~10 km grid: 0.1° of latitude. */
function gridKey(lat: number, lon: number): string {
  return `${Math.round(lat * 10)},${Math.round(lon * 10)}`;
}

interface CacheShape {
  [key: string]: { d: number; at: number };
}

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as CacheShape) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage full/disabled — the in-flight value still gets used
  }
}

/**
 * Declination in degrees (+E) for a location: cached grid value when present
 * (never expired — stale beats none), else fetched and cached. Returns null
 * only when there is no cache AND the network fetch fails; callers should then
 * proceed with magnetic north (≤ ~5° error in Iraq) rather than block.
 */
export async function getDeclination(lat: number, lon: number): Promise<number | null> {
  const key = gridKey(lat, lon);
  const cache = readCache();
  const hit = cache[key];
  if (hit && typeof hit.d === "number" && Number.isFinite(hit.d)) return hit.d;

  try {
    const res = await fetchDeclination(lat, lon);
    const entries = Object.entries(cache);
    // Bound the cache: keep the 20 most recent grid cells.
    const trimmed = Object.fromEntries(
      entries.sort((a, b) => b[1].at - a[1].at).slice(0, 19),
    );
    writeCache({ ...trimmed, [key]: { d: res.declinationDeg, at: Date.now() } });
    return res.declinationDeg;
  } catch {
    return null;
  }
}
