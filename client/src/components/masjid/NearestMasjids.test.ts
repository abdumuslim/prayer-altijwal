import { describe, it, expect } from "vitest";
import { embedUrl, mapsUrl } from "./NearestMasjids";
import type { Masjid } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

// The user's real GPS fix that both helpers navigate FROM.
const FROM: StoredLocation = {
  city: "Baghdad",
  country: "IQ",
  tz: "Asia/Baghdad",
  lat: 33.3152,
  lon: 44.3661,
  elevation: null,
  source: "gps",
};

// One masjid of each id class (docs/QIBLA_MASJID_SPEC.md §6a merge order):
// a live Google place, a resident OSM row, a user contribution.
const GOOGLE: Masjid = {
  id: "ChIJd8BlQ2BZwokRAFUEcm_qrcA",
  name: "Google masjid",
  lat: 33.316,
  lon: 44.367,
  address: null,
};
const OSM: Masjid = {
  id: "osm:node/123456",
  name: "OSM masjid",
  lat: 33.318,
  lon: 44.369,
  address: null,
};
const USR: Masjid = {
  id: "usr:local-abc",
  name: "User masjid",
  lat: 33.32,
  lon: 44.371,
  address: null,
};

describe("embedUrl", () => {
  // The regression: a stale/invalidated Google place_id used to reach the
  // un-proxied Embed iframe and render Google's raw "Invalid 'destination'
  // parameter" error page inside the card. Coordinates must always win.
  for (const [label, m] of [
    ["google id", GOOGLE],
    ["osm id", OSM],
    ["usr id", USR],
  ] as const) {
    it(`targets coordinates and never a place_id (${label})`, () => {
      const url = embedUrl(m, FROM, "EMBED_KEY");
      const params = new URL(url).searchParams;
      expect(params.get("destination")).toBe(`${m.lat},${m.lon}`);
      expect(url).not.toContain("place_id");
      // The un-proxied request still carries the key, origin and language.
      expect(params.get("key")).toBe("EMBED_KEY");
      expect(params.get("origin")).toBe(`${FROM.lat},${FROM.lon}`);
      expect(params.get("language")).toBe("ar");
    });
  }
});

describe("mapsUrl", () => {
  it("keeps the place_id for a Google id — the deep link degrades gracefully", () => {
    const url = mapsUrl(GOOGLE);
    expect(url).toContain(`destination=${GOOGLE.lat},${GOOGLE.lon}`);
    expect(url).toContain(`destination_place_id=${GOOGLE.id}`);
  });

  it("omits the place_id for osm/usr ids (meaningless to Google)", () => {
    for (const m of [OSM, USR]) {
      const url = mapsUrl(m);
      expect(url).toContain(`destination=${m.lat},${m.lon}`);
      expect(url).not.toContain("place_id");
    }
  });
});
