import { describe, expect, test } from "vitest";
import { ADHKAR_LISTS, listProgress, slotComplete, type DhikrItem } from "./adhkar-data";

const items: DhikrItem[] = [
  { id: "a", textAr: "أ", repeat: 3 },
  { id: "b", textAr: "ب", repeat: 33 },
  { id: "c", textAr: "ج", repeat: 1 },
];

describe("slotComplete", () => {
  test("false while any item is short of its repeat target", () => {
    expect(slotComplete([], items)).toBe(false);
    expect(slotComplete([3, 32, 1], items)).toBe(false);
    expect(slotComplete([3, 33], items)).toBe(false); // third item untouched
  });

  test("true once every item reached its target (overshoot ok)", () => {
    expect(slotComplete([3, 33, 1], items)).toBe(true);
    expect(slotComplete([5, 40, 2], items)).toBe(true);
  });
});

describe("listProgress", () => {
  test("moves per completed dhikr item (fraction of items done)", () => {
    expect(listProgress([], items)).toBe(0);
    expect(listProgress([3, 32, 0], items)).toBeCloseTo(1 / 3); // only the first done
    expect(listProgress([3, 33, 0], items)).toBeCloseTo(2 / 3);
    expect(listProgress([3, 33, 1], items)).toBe(1);
  });
});

describe("ADHKAR_LISTS", () => {
  test("every slot has a non-empty list with positive repeats and unique ids", () => {
    for (const list of Object.values(ADHKAR_LISTS)) {
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((d) => d.id)).size).toBe(list.length);
      for (const d of list) expect(d.repeat).toBeGreaterThan(0);
    }
  });

  test("fajr and maghrib carry the ×10 tahlil extra; fajr also the knowledge dua", () => {
    const ids = (slot: keyof typeof ADHKAR_LISTS) => ADHKAR_LISTS[slot].map((d) => d.id);
    expect(ids("afterFajr")).toContain("tahlil-x10");
    expect(ids("afterMaghrib")).toContain("tahlil-x10");
    expect(ids("afterDhuhr")).not.toContain("tahlil-x10");
    expect(ids("afterFajr")).toContain("ilm-nafi");
  });
});
