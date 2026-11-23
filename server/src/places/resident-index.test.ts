import { describe, it, expect } from "vitest";
import { ResidentIndex } from "./resident-index.js";
import type { Masjid } from "./google-places.js";

const KARRADA = { lat: 33.3, lon: 44.42 };

/** A believable Iraqi-city cluster: several masjids within walking distance. */
const ROWS = [
  { n: "جامع الرحمن", lat: 33.3005, lon: 44.4205, oid: "n1" },
  { n: "مسجد الهدى", lat: 33.302, lon: 44.421, oid: "n2" },
  { n: "جامع بلال", lat: 33.305, lon: 44.425, oid: "w3" },
  { n: "جامع النور", lat: 33.31, lon: 44.43, oid: "n4" },
  // A different city entirely.
  { n: "جامع البصرة", lat: 30.5, lon: 47.8, oid: "n5" },
];

describe("ResidentIndex", () => {
  it("returns the nearest masjids, closest first", () => {
    const idx = ResidentIndex.fromRows(ROWS);
    const near = idx.nearest(KARRADA.lat, KARRADA.lon, 5, 3);
    expect(near.map((m) => m.name)).toEqual(["جامع الرحمن", "مسجد الهدى", "جامع بلال"]);
  });

  it("honours the radius and never returns a masjid in another city", () => {
    const idx = ResidentIndex.fromRows(ROWS);
    const near = idx.nearest(KARRADA.lat, KARRADA.lon, 5, 20);
    expect(near.map((m) => m.name)).not.toContain("جامع البصرة");
  });

  it("finds results across a latitude band boundary", () => {
    // 33.999 and 34.001 fall in different 1° bands; the search must span them.
    const idx = ResidentIndex.fromRows([
      { n: "شمال", lat: 34.001, lon: 44, oid: "n1" },
      { n: "جنوب", lat: 33.999, lon: 44, oid: "n2" },
    ]);
    expect(idx.nearest(34.0, 44, 5, 10)).toHaveLength(2);
  });

  it("applies the SAME venue exclusion as the Google path", () => {
    const idx = ResidentIndex.fromRows([
      ...ROWS,
      { n: "حسينية الإمام", lat: 33.3001, lon: 44.4201, oid: "n9" },
      { n: "موكب الخدمة", lat: 33.3002, lon: 44.4202, oid: "n10" },
    ]);
    const names = idx.nearest(KARRADA.lat, KARRADA.lon, 5, 20).map((m) => m.name);
    expect(names).not.toContain("حسينية الإمام");
    expect(names).not.toContain("موكب الخدمة");
    // …while a Hussein-NAMED mosque is still a mosque.
    const kept = ResidentIndex.fromRows([{ n: "جامع الإمام الحسين", lat: 33.3, lon: 44.42, oid: "n11" }]);
    expect(kept.size).toBe(1);
  });

  it("namespaces ids so a resident masjid is never mistaken for a Google place", () => {
    const idx = ResidentIndex.fromRows(ROWS);
    expect(idx.nearest(KARRADA.lat, KARRADA.lon, 5, 1)[0]!.id).toBe("osm:n1");
  });

  it("skips malformed rows instead of poisoning the index", () => {
    const idx = ResidentIndex.fromRows([
      { n: "صالح", lat: 33.3, lon: 44.42, oid: "n1" },
      { n: "بلا إحداثيات", lat: Number.NaN, lon: 44.42, oid: "n2" },
      { lat: 33.3, lon: 44.42, oid: "n3" } as never,
    ]);
    expect(idx.size).toBe(1);
  });

  it("is empty (not broken) when the dataset file is missing", () => {
    const idx = ResidentIndex.load("D:/definitely/not/a/file.json");
    expect(idx.size).toBe(0);
    expect(idx.nearest(33.3, 44.4, 5, 5)).toEqual([]);
    expect(idx.isDenseAt(33.3, 44.4)).toBe(false);
  });

  it("never throws on a nonsense position", () => {
    const idx = ResidentIndex.fromRows(ROWS);
    expect(idx.nearest(Number.NaN, 44, 5, 5)).toEqual([]);
  });

  describe("isDenseAt", () => {
    it("is true in a well-mapped quarter — Google would add little here", () => {
      expect(ResidentIndex.fromRows(ROWS).isDenseAt(KARRADA.lat, KARRADA.lon)).toBe(true);
    });

    it("is false when only one masjid is known nearby (an OSM gap)", () => {
      const sparse = ResidentIndex.fromRows([{ n: "وحيد", lat: 33.3005, lon: 44.4205, oid: "n1" }]);
      expect(sparse.isDenseAt(KARRADA.lat, KARRADA.lon)).toBe(false);
    });

    it("is false when the nearest known masjid is far, even if several exist", () => {
      const far = ResidentIndex.fromRows([
        { n: "أ", lat: 33.32, lon: 44.44, oid: "n1" },
        { n: "ب", lat: 33.321, lon: 44.441, oid: "n2" },
        { n: "ج", lat: 33.322, lon: 44.442, oid: "n3" },
      ]);
      expect(far.isDenseAt(KARRADA.lat, KARRADA.lon)).toBe(false);
    });
  });

  describe("community layer", () => {
    it("merges user-contributed masjids into the same search", () => {
      const idx = ResidentIndex.fromRows(ROWS);
      const contributed: Masjid[] = [
        { id: "usr:7", name: "مسجد الحي", lat: 33.3001, lon: 44.4202, address: null },
      ];
      idx.setCommunity(contributed);
      expect(idx.size).toBe(ROWS.length + 1);
      expect(idx.nearest(KARRADA.lat, KARRADA.lon, 5, 10).map((m) => m.id)).toContain("usr:7");
    });

    it("replaces rather than accumulates on refresh", () => {
      const idx = ResidentIndex.fromRows(ROWS);
      const one: Masjid[] = [{ id: "usr:1", name: "أ", lat: 33.3, lon: 44.42, address: null }];
      idx.setCommunity(one);
      idx.setCommunity(one);
      expect(idx.size).toBe(ROWS.length + 1);
    });
  });

  describe("nearestCommunity", () => {
    const community: Masjid[] = [
      { id: "usr:2", name: "ثاني", lat: 33.304, lon: 44.42, address: null },
      { id: "usr:1", name: "أول", lat: 33.3002, lon: 44.4201, address: null },
      { id: "usr:9", name: "بعيد", lat: 30.5, lon: 47.8, address: null },
    ];

    it("returns only community rows, never the bundled base rows", () => {
      const idx = ResidentIndex.fromRows(ROWS);
      expect(idx.nearestCommunity(KARRADA.lat, KARRADA.lon, 5, 10)).toEqual([]);
      idx.setCommunity(community);
      const ids = idx.nearestCommunity(KARRADA.lat, KARRADA.lon, 5, 10).map((m) => m.id);
      expect(ids).toEqual(["usr:1", "usr:2"]);
      // The same search over everything still sees the base rows.
      expect(idx.nearest(KARRADA.lat, KARRADA.lon, 5, 20).some((m) => m.id.startsWith("osm:"))).toBe(
        true,
      );
    });

    it("honours the radius and the limit", () => {
      const idx = ResidentIndex.fromRows([]);
      idx.setCommunity(community);
      expect(idx.nearestCommunity(KARRADA.lat, KARRADA.lon, 0.1, 10)).toEqual([]);
      expect(idx.nearestCommunity(KARRADA.lat, KARRADA.lon, 5, 1).map((m) => m.id)).toEqual(["usr:1"]);
    });

    it("finds rows across a latitude band boundary and follows a refresh", () => {
      const idx = ResidentIndex.fromRows([]);
      idx.setCommunity([
        { id: "usr:3", name: "شمال", lat: 34.001, lon: 44, address: null },
        { id: "usr:4", name: "جنوب", lat: 33.999, lon: 44, address: null },
      ]);
      expect(idx.nearestCommunity(34.0, 44, 5, 10)).toHaveLength(2);
      idx.setCommunity([]);
      expect(idx.nearestCommunity(34.0, 44, 5, 10)).toEqual([]);
    });

    it("never throws on a nonsense position", () => {
      const idx = ResidentIndex.fromRows([]);
      idx.setCommunity(community);
      expect(idx.nearestCommunity(Number.NaN, 44, 5, 5)).toEqual([]);
    });
  });
});
