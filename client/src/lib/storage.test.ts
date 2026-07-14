import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DEFAULT_STATE,
  DEFAULT_WORSHIP_FEATURES,
  loadState,
  patchState,
} from "./storage";

const KEY = "prayer.app.v1";

/* ── in-memory localStorage stub (mirrors worship-storage.test.ts) ───────── */

let store: Map<string, string>;

beforeEach(() => {
  store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const seed = (raw: unknown) => store.set(KEY, JSON.stringify(raw));

describe("worship features", () => {
  test("default state has every feature off", () => {
    expect(DEFAULT_STATE.features).toEqual({
      duha: false,
      qiyam: false,
      rawatib: false,
      adhkar: false,
      record: false,
    });
    // DEFAULT_STATE holds a fresh copy, not the shared constant reference.
    expect(DEFAULT_STATE.features).not.toBe(DEFAULT_WORSHIP_FEATURES);
  });

  test("no stored state → features all off", () => {
    expect(loadState().features).toEqual(DEFAULT_WORSHIP_FEATURES);
  });

  test("legacy envelope missing `features` migrates to all off", () => {
    seed({ v: 1, method: "MWL", iqamaMinutes: {} }); // pre-feature shape
    expect(loadState().features).toEqual(DEFAULT_WORSHIP_FEATURES);
  });

  test("coerces garbage and truthy-but-not-true values to false", () => {
    seed({ v: 1, features: "nope" });
    expect(loadState().features).toEqual(DEFAULT_WORSHIP_FEATURES);

    seed({ v: 1, features: { duha: 1, qiyam: "yes", rawatib: null, record: {} } });
    expect(loadState().features).toEqual(DEFAULT_WORSHIP_FEATURES);
  });

  test("preserves real booleans and ignores unknown keys", () => {
    seed({ v: 1, features: { duha: true, adhkar: true, bogus: true } });
    expect(loadState().features).toEqual({
      duha: true,
      qiyam: false,
      rawatib: false,
      adhkar: true,
      record: false,
    });
  });

  test("patchState round-trips the features object", () => {
    const next = { ...DEFAULT_WORSHIP_FEATURES, record: true, rawatib: true };
    patchState({ features: next });
    expect(loadState().features).toEqual(next);
  });
});

describe("location source migration (QIBLA_MASJID_SPEC §6b)", () => {
  const BASE_LOCATION = {
    city: "Baghdad",
    country: "IQ",
    tz: "Asia/Baghdad",
    lat: 33.34058,
    lon: 44.40088,
    elevation: 41,
  };

  test("pre-existing location without source → source stays undefined", () => {
    seed({ v: 1, location: BASE_LOCATION });
    expect(loadState().location?.source).toBeUndefined();
  });

  test("valid source values survive the round-trip", () => {
    for (const source of ["gps", "search", "default"] as const) {
      seed({ v: 1, location: { ...BASE_LOCATION, source } });
      expect(loadState().location?.source).toBe(source);
    }
  });

  test("garbage source is dropped, location otherwise intact", () => {
    seed({ v: 1, location: { ...BASE_LOCATION, source: "satellite" } });
    const loc = loadState().location;
    expect(loc?.source).toBeUndefined();
    expect(loc?.city).toBe("Baghdad");
    expect(loc?.lat).toBe(33.34058);
  });
});

describe("alarmSound coercion", () => {
  test("keeps bundled tone ids", () => {
    seed({ v: 1, alarmSound: "classic" });
    expect(loadState().alarmSound).toBe("classic");
  });

  test("keeps device tone ids (native system tones)", () => {
    const id = "device:content://media/internal/audio/media/42";
    seed({ v: 1, alarmSound: id });
    expect(loadState().alarmSound).toBe(id);
  });

  test("coerces unknown ids to the default", () => {
    seed({ v: 1, alarmSound: "not-a-tone" });
    expect(loadState().alarmSound).toBe(DEFAULT_STATE.alarmSound);
  });
});
