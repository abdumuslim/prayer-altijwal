import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CACHE_FRESH_MS,
  CACHE_MAX_AGE_MS,
  cellOf,
  clearMasjidCache,
  readMasjidCache,
  writeMasjidCache,
} from "./masjid-cache";
import type { Masjid } from "@/types/api";

const BAGHDAD = { lat: 33.3152, lon: 44.3661 };
const MASJIDS: Masjid[] = [
  { id: "a", name: "جامع الرحمن", lat: 33.316, lon: 44.367, address: null },
];

describe("cellOf", () => {
  it("groups nearby points into one cell and separates distant ones", () => {
    expect(cellOf(33.3152, 44.3661)).toBe(cellOf(33.3153, 44.3662));
    expect(cellOf(33.3152, 44.3661)).not.toBe(cellOf(33.35, 44.4));
  });
});

/* ── in-memory localStorage stub (mirrors storage.test.ts) ───────────────── */
let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe("masjid cache", () => {
  beforeEach(() => {
    clearMasjidCache();
  });

  it("returns null when nothing has been stored", () => {
    expect(readMasjidCache(BAGHDAD.lat, BAGHDAD.lon)).toBeNull();
  });

  it("round-trips a list and reports it fresh in the same cell", () => {
    writeMasjidCache(BAGHDAD.lat, BAGHDAD.lon, MASJIDS, "embed", 1000);
    const hit = readMasjidCache(BAGHDAD.lat, BAGHDAD.lon, 2000);
    expect(hit).not.toBeNull();
    expect(hit!.masjids).toEqual(MASJIDS);
    expect(hit!.embedKey).toBe("embed");
    expect(hit!.sameCell).toBe(true);
    expect(hit!.fresh).toBe(true);
  });

  it("stops being FRESH past the freshness window but stays usable", () => {
    writeMasjidCache(BAGHDAD.lat, BAGHDAD.lon, MASJIDS, undefined, 0);
    const hit = readMasjidCache(BAGHDAD.lat, BAGHDAD.lon, CACHE_FRESH_MS + 1);
    expect(hit!.fresh).toBe(false); // a refresh is due…
    expect(hit!.masjids).toEqual(MASJIDS); // …but it still paints instantly
  });

  it("is usable but never fresh from a DIFFERENT cell — the offline fallback", () => {
    writeMasjidCache(BAGHDAD.lat, BAGHDAD.lon, MASJIDS, undefined, 0);
    const hit = readMasjidCache(33.5, 44.6, 1000);
    expect(hit!.sameCell).toBe(false);
    expect(hit!.fresh).toBe(false);
    expect(hit!.masjids).toEqual(MASJIDS);
  });

  it("drops an entry past the 30-day retention limit rather than serving it", () => {
    writeMasjidCache(BAGHDAD.lat, BAGHDAD.lon, MASJIDS, undefined, 0);
    expect(readMasjidCache(BAGHDAD.lat, BAGHDAD.lon, CACHE_MAX_AGE_MS + 1)).toBeNull();
    // …and it is actually deleted, not merely hidden — Google's terms require
    // the content to be gone, and a phone's localStorage is still a copy.
    expect(localStorage.getItem("prayer.masjids.v1")).toBeNull();
  });

  it("ignores a clock that jumped backwards", () => {
    writeMasjidCache(BAGHDAD.lat, BAGHDAD.lon, MASJIDS, undefined, 10_000);
    expect(readMasjidCache(BAGHDAD.lat, BAGHDAD.lon, 5_000)).toBeNull();
  });

  it("does not store an empty list — nothing to gain, and it would mask a refresh", () => {
    writeMasjidCache(BAGHDAD.lat, BAGHDAD.lon, [], undefined, 0);
    expect(readMasjidCache(BAGHDAD.lat, BAGHDAD.lon, 1)).toBeNull();
  });

  it("survives corrupt storage without throwing", () => {
    localStorage.setItem("prayer.masjids.v1", "{not json");
    expect(readMasjidCache(BAGHDAD.lat, BAGHDAD.lon)).toBeNull();
    localStorage.setItem("prayer.masjids.v1", JSON.stringify({ cell: 1 }));
    expect(readMasjidCache(BAGHDAD.lat, BAGHDAD.lon)).toBeNull();
  });
});
