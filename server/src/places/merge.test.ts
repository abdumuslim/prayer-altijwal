import { describe, it, expect } from "vitest";
import { isSameMasjid, mergeMasjids } from "./merge.js";
import type { Masjid } from "./google-places.js";

function m(id: string, name: string, lat: number, lon: number, address: string | null = null): Masjid {
  return { id, name, lat, lon, address };
}

describe("isSameMasjid", () => {
  it("treats two records at the same spot as one building, whatever they are called", () => {
    // OSM and Google routinely disagree on the name of the same masjid.
    expect(isSameMasjid(m("osm:n1", "جامع الرحمن", 33.3, 44.42), m("g1", "Al Rahman Mosque", 33.3001, 44.4201))).toBe(
      true,
    );
  });

  it("keeps two genuinely different masjids in a dense quarter apart", () => {
    // ~300 m apart: normal spacing in an Iraqi neighbourhood.
    expect(isSameMasjid(m("osm:n1", "جامع الرحمن", 33.3, 44.42), m("g1", "جامع النور", 33.3027, 44.42))).toBe(false);
  });

  it("merges near-but-not-identical coordinates when the names agree", () => {
    // ~90 m apart — Google's pin and OSM's pin for one large mosque compound.
    expect(isSameMasjid(m("osm:n1", "جامع الإمام الأعظم", 33.3, 44.42), m("g1", "جامع الإمام الأعظم", 33.3008, 44.42))).toBe(
      true,
    );
  });

  it("does NOT merge near neighbours whose names only share filler words", () => {
    // "مسجد" alone is not evidence — nearly every entry contains it.
    expect(isSameMasjid(m("osm:n1", "مسجد الرحمن", 33.3, 44.42), m("g1", "مسجد النور", 33.3008, 44.42))).toBe(false);
  });

  it("ignores the definite article when comparing names", () => {
    expect(isSameMasjid(m("osm:n1", "جامع الرحمن", 33.3, 44.42), m("g1", "جامع رحمن", 33.3008, 44.42))).toBe(true);
  });
});

describe("mergeMasjids", () => {
  const resident = [m("osm:n1", "جامع الرحمن", 33.3, 44.42), m("osm:n2", "مسجد الهدى", 33.305, 44.425)];

  it("adds Google masjids the resident data has never heard of", () => {
    const merged = mergeMasjids(resident, [m("g9", "جامع جديد", 33.31, 44.43)]);
    expect(merged).toHaveLength(3);
    expect(merged.map((x) => x.id)).toContain("g9");
  });

  it("does not duplicate a masjid both sources know about", () => {
    const merged = mergeMasjids(resident, [m("g1", "Al Rahman Mosque", 33.3001, 44.4201)]);
    expect(merged).toHaveLength(2);
  });

  it("keeps the resident (Arabic, locally authored) name over Google's", () => {
    const merged = mergeMasjids(resident, [m("g1", "Al Rahman Mosque", 33.3001, 44.4201)]);
    expect(merged[0]!.name).toBe("جامع الرحمن");
  });

  it("adopts Google's place ID, which makes the Maps deep link precise", () => {
    const merged = mergeMasjids(resident, [m("g1", "Al Rahman Mosque", 33.3001, 44.4201)]);
    expect(merged[0]!.id).toBe("g1");
  });

  it("adopts an address the resident record lacks", () => {
    const merged = mergeMasjids(resident, [
      m("g1", "Al Rahman Mosque", 33.3001, 44.4201, "الكرادة، بغداد"),
    ]);
    expect(merged[0]!.address).toBe("الكرادة، بغداد");
  });

  it("returns the resident list unchanged when there is nothing to merge", () => {
    expect(mergeMasjids(resident, [])).toEqual(resident);
  });

  it("returns the Google list when there is no resident data at all", () => {
    const google = [m("g1", "جامع", 33.3, 44.42)];
    expect(mergeMasjids([], google)).toEqual(google);
  });

  it("does not mutate its inputs", () => {
    const before = [...resident];
    mergeMasjids(resident, [m("g9", "جامع جديد", 33.31, 44.43)]);
    expect(resident).toEqual(before);
  });
});
