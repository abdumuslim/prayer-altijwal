import { describe, expect, it } from "vitest";
import {
  TELEMETRY_PRECISION_DEG,
  buildPingBody,
  readState,
  roundCoord,
  shouldPing,
  type PingInput,
} from "./telemetry";

const INPUT: PingInput = {
  platform: "android",
  appVersion: "2.3.0",
  lat: 33.315274,
  lon: 44.366108,
  locSource: "gps",
  tz: "Asia/Baghdad",
  features: ["qiyam", "duha"],
  notif: true,
  theme: "night",
  displayMode: "native",
};

describe("shouldPing", () => {
  it("sends when nothing has been sent yet", () => {
    expect(shouldPing(null, "2026-07-26")).toBe(true);
    expect(shouldPing(undefined, "2026-07-26")).toBe(true);
  });

  it("does NOT send twice in the same local day", () => {
    expect(shouldPing("2026-07-26", "2026-07-26")).toBe(false);
  });

  it("sends again the next day", () => {
    expect(shouldPing("2026-07-26", "2026-07-27")).toBe(true);
  });

  it("refuses to send without a usable day key", () => {
    expect(shouldPing(null, "")).toBe(false);
  });
});

describe("roundCoord", () => {
  it("coarsens to the ~1.1 km grid", () => {
    expect(roundCoord(33.315274)).toBe(33.32);
    expect(roundCoord(44.366108)).toBe(44.37);
  });

  it("maps everything inside one cell to the same value", () => {
    expect(roundCoord(33.3151)).toBe(roundCoord(33.3199));
  });

  it("never emits more precision than declared", () => {
    for (let i = 0; i < 500; i++) {
      const v = roundCoord(29 + i * 0.0137);
      const decimals = String(v).split(".")[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(2);
    }
  });

  it("survives a non-finite coordinate rather than sending NaN", () => {
    expect(roundCoord(Number.NaN)).toBe(0);
    expect(roundCoord(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("is declared at ~1.1 km", () => {
    // Guards the constant itself: changing it is a privacy-policy and Play
    // Data Safety change, not a tweak.
    expect(TELEMETRY_PRECISION_DEG).toBe(0.01);
  });
});

describe("buildPingBody", () => {
  it("sends only coarsened coordinates", () => {
    const body = buildPingBody(INPUT);
    expect(body.lat).toBe(33.32);
    expect(body.lon).toBe(44.37);
    // The precise input must not survive anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain("33.315274");
    expect(JSON.stringify(body)).not.toContain("44.366108");
  });

  it("carries no identifier of any kind", () => {
    const keys = Object.keys(buildPingBody(INPUT));
    for (const forbidden of ["clientId", "id", "uid", "endpoint", "email"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("sorts features so the same state produces the same body", () => {
    expect(buildPingBody(INPUT).features).toEqual(["duha", "qiyam"]);
    expect(buildPingBody({ ...INPUT, features: ["duha", "qiyam"] }).features).toEqual([
      "duha",
      "qiyam",
    ]);
  });

  it("omits locSource when it is unknown rather than guessing", () => {
    const { locSource: _omitted, ...withoutSource } = INPUT;
    expect(buildPingBody(withoutSource as PingInput).locSource).toBeUndefined();
  });
});

describe("readState", () => {
  it("survives missing or corrupt storage", () => {
    expect(readState(null)).toEqual({});
    expect(readState("")).toEqual({});
    expect(readState("{not json")).toEqual({});
    expect(readState("null")).toEqual({});
    expect(readState('"a string"')).toEqual({});
  });

  it("reads back a stored day", () => {
    expect(readState('{"lastDay":"2026-07-26"}').lastDay).toBe("2026-07-26");
  });
});
