import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fetchTravelMinutes } from "./google-routes.js";
import type { Masjid } from "./google-places.js";

const ORIGIN = { lat: 33.3152, lon: 44.3661 };
const MASJIDS: Masjid[] = [
  { id: "a", name: "جامع أ", lat: 33.32, lon: 44.37, address: null },
  { id: "b", name: "جامع ب", lat: 33.33, lon: 44.38, address: null },
];

/** Queue one JSON body per upstream call, in WALK-then-DRIVE order. */
function mockFetchSequence(bodies: Array<unknown | { status: number }>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const mode = JSON.parse(String(init.body)).travelMode as string;
    const body = mode === "WALK" ? bodies[0] : bodies[1];
    if (body && typeof body === "object" && "status" in body) {
      return { ok: false, status: (body as { status: number }).status } as Response;
    }
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn as unknown as ReturnType<typeof vi.fn>;
}

const walkBody = [
  { originIndex: 0, destinationIndex: 0, duration: "1200s", condition: "ROUTE_EXISTS" },
  { originIndex: 0, destinationIndex: 1, duration: "2400s", condition: "ROUTE_EXISTS" },
];
const driveBody = [
  { originIndex: 0, destinationIndex: 0, duration: "240s", condition: "ROUTE_EXISTS" },
  { originIndex: 0, destinationIndex: 1, duration: "480s", condition: "ROUTE_EXISTS" },
];

describe("fetchTravelMinutes", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns walking and driving minutes per masjid", async () => {
    mockFetchSequence([walkBody, driveBody]);
    const out = await fetchTravelMinutes(ORIGIN, MASJIDS, "key");
    expect(out).toEqual([
      { walkMin: 20, driveMin: 4 },
      { walkMin: 40, driveMin: 8 },
    ]);
  });

  it("sends one request per travel mode, with the origin and every destination", async () => {
    const fn = mockFetchSequence([walkBody, driveBody]);
    await fetchTravelMinutes(ORIGIN, MASJIDS, "key");

    expect(fn).toHaveBeenCalledTimes(2);
    const modes = fn.mock.calls.map((c) => JSON.parse(String(c[1].body)).travelMode);
    expect(modes.sort()).toEqual(["DRIVE", "WALK"]);

    const [, init] = fn.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.origins).toHaveLength(1);
    expect(body.origins[0].waypoint.location.latLng).toEqual({
      latitude: ORIGIN.lat,
      longitude: ORIGIN.lon,
    });
    expect(body.destinations).toHaveLength(2);
    // routingPreference is DRIVE-only — sending it with WALK is a 400.
    expect(body.routingPreference).toBeUndefined();
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("key");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("duration");
  });

  it("rounds up sub-minute routes to 1 (never '0 minutes away')", async () => {
    mockFetchSequence([
      [{ originIndex: 0, destinationIndex: 0, duration: "20s", condition: "ROUTE_EXISTS" }],
      [{ originIndex: 0, destinationIndex: 0, duration: "5s", condition: "ROUTE_EXISTS" }],
    ]);
    const out = await fetchTravelMinutes(ORIGIN, [MASJIDS[0]], "key");
    expect(out).toEqual([{ walkMin: 1, driveMin: 1 }]);
  });

  it("drops legs Google could not route", async () => {
    mockFetchSequence([
      [{ originIndex: 0, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" }],
      [{ originIndex: 0, destinationIndex: 0, duration: "300s", condition: "ROUTE_EXISTS" }],
    ]);
    const out = await fetchTravelMinutes(ORIGIN, [MASJIDS[0]], "key");
    expect(out).toEqual([{ walkMin: null, driveMin: 5 }]);
  });

  it("one mode failing still yields the other", async () => {
    mockFetchSequence([{ status: 403 }, driveBody]);
    const out = await fetchTravelMinutes(ORIGIN, MASJIDS, "key");
    expect(out).toEqual([
      { walkMin: null, driveMin: 4 },
      { walkMin: null, driveMin: 8 },
    ]);
  });

  it("both modes failing → null (caller keeps the masjid list)", async () => {
    mockFetchSequence([{ status: 500 }, { status: 500 }]);
    expect(await fetchTravelMinutes(ORIGIN, MASJIDS, "key")).toBeNull();
  });

  it("never throws when the upstream rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await fetchTravelMinutes(ORIGIN, MASJIDS, "key")).toBeNull();
  });

  it("malformed upstream JSON is rejected by validation, not trusted", async () => {
    mockFetchSequence([{ nonsense: true }, { nonsense: true }]);
    expect(await fetchTravelMinutes(ORIGIN, MASJIDS, "key")).toBeNull();
  });

  it("no masjids → no upstream calls", async () => {
    const fn = mockFetchSequence([walkBody, driveBody]);
    expect(await fetchTravelMinutes(ORIGIN, [], "key")).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});
