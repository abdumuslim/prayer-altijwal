import { describe, it, expect, afterEach, vi } from "vitest";
import { searchNearbyMasjids } from "./google-places.js";

const BAGHDAD = { lat: 33.3152, lon: 44.3661 };
const KEY = "test-api-key";

/** Minimal Response stand-in — the client only touches ok/status/json. */
function fakeResponse(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function upstreamPlace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "place-1",
    displayName: { text: "جامع الإمام الأعظم" },
    location: { latitude: 33.372, longitude: 44.355 },
    shortFormattedAddress: "الأعظمية، بغداد",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("searchNearbyMasjids — happy path", () => {
  it("maps upstream places into the public Masjid shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fakeResponse(true, 200, { places: [upstreamPlace()] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY);
    expect(result).toEqual([
      {
        id: "place-1",
        name: "جامع الإمام الأعظم",
        lat: 33.372,
        lon: 44.355,
        address: "الأعظمية، بغداد",
      },
    ]);
  });

  it("sends the key + field mask in headers and a distance-ranked mosque body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(true, 200, { places: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Goog-Api-Key"]).toBe(KEY);
    expect(headers["X-Goog-FieldMask"]).toContain("places.displayName");
    const body = JSON.parse(init.body as string);
    expect(body.includedTypes).toEqual(["mosque"]);
    expect(body.rankPreference).toBe("DISTANCE");
    expect(body.languageCode).toBe("ar");
    expect(body.locationRestriction.circle.center).toEqual({
      latitude: BAGHDAD.lat,
      longitude: BAGHDAD.lon,
    });
    expect(body.locationRestriction.circle.radius).toBe(5000);
  });

  it("treats a missing `places` field as a genuine empty result ([])", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(true, 200, {})));
    expect(await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY)).toEqual([]);
  });

  it("excludes non-mosque venues by name — husseiniya variants, mawkib, mudhif (user rule)", async () => {
    const body = {
      places: [
        upstreamPlace(), // جامع الإمام الأعظم — kept
        upstreamPlace({ id: "h-1", displayName: { text: "حسينية الزهراء" } }),
        upstreamPlace({ id: "h-2", displayName: { text: "مسجد وحسينية اهل البيت" } }),
        upstreamPlace({ id: "h-3", displayName: { text: "حسينيه أبو الفضل" } }), // ه spelling
        upstreamPlace({ id: "h-4", displayName: { text: "حسينيّة الإمام علي" } }), // with shadda
        upstreamPlace({ id: "h-5", displayName: { text: "Husseiniya Al-Zahraa" } }),
        // Live-caught Karbala variants (2026-07-19 prod check):
        upstreamPlace({ id: "h-6", displayName: { text: "حسينة الطهرانية" } }), // no-ya spelling
        upstreamPlace({ id: "h-7", displayName: { text: "حسینیه شاه وفا" } }), // FARSI YEH
        upstreamPlace({ id: "m-1", displayName: { text: "موکب حضرت زهرا ایرا لواسان" } }), // FARSI KAF
        upstreamPlace({ id: "m-2", displayName: { text: "مضيف الإمام الرضا عليه السلام" } }),
        // Hussein-NAMED prayer sites are mosques — must be kept:
        upstreamPlace({ id: "keep-1", displayName: { text: "جامع الإمام الحسين" } }),
        upstreamPlace({ id: "keep-2", displayName: { text: "مسجد الحسيني" } }),
        upstreamPlace({ id: "keep-3", displayName: { text: "مرقد الامام الحسين عليه السلام" } }),
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(true, 200, body)));

    const result = await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY);
    expect(result?.map((m) => m.id)).toEqual(["place-1", "keep-1", "keep-2", "keep-3"]);
  });

  it("drops malformed entries but keeps valid ones", async () => {
    const body = {
      places: [
        upstreamPlace(),
        { id: "no-name", location: { latitude: 1, longitude: 2 } },
        { id: "no-coords", displayName: { text: "مسجد" } },
        "not-an-object",
        { ...upstreamPlace({ id: "place-2", shortFormattedAddress: undefined }) },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(true, 200, body)));

    const result = await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY);
    expect(result?.map((m) => m.id)).toEqual(["place-1", "place-2"]);
    expect(result?.[1]?.address).toBeNull();
  });
});

describe("searchNearbyMasjids — failure modes (never throws, returns null)", () => {
  it("non-OK upstream status → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(false, 403, {})));
    expect(await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY)).toBeNull();
  });

  it("network error → null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY)).toBeNull();
  });

  it("bad JSON → null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      } as unknown as Response),
    );
    expect(await searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY)).toBeNull();
  });

  it("timeout (5 s) aborts the request → null", async () => {
    vi.useFakeTimers();
    // Never resolves on its own; rejects only when the AbortSignal fires.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      ),
    );

    const pending = searchNearbyMasjids(BAGHDAD.lat, BAGHDAD.lon, KEY);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toBeNull();
  });
});
