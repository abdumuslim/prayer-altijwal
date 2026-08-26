import { describe, expect, it } from "vitest";
import { appendEntry, parseLog, toEntry, type ErrorEntry } from "./error-log";

function entry(ts: number, message = "boom"): ErrorEntry {
  return { ts, kind: "test", message };
}

describe("toEntry", () => {
  it("stamps ts and keeps the supplied fields", () => {
    const e = toEntry({ kind: "window.error", message: "boom", stack: "at x" }, 123);
    expect(e).toEqual({ ts: 123, kind: "window.error", message: "boom", stack: "at x" });
  });

  it("omits stack/extra when absent rather than storing undefined", () => {
    const e = toEntry({ kind: "k", message: "m" }, 1);
    expect("stack" in e).toBe(false);
    expect("extra" in e).toBe(false);
  });

  it("carries structured extra through untouched", () => {
    const e = toEntry({ kind: "native-alarm-cap", message: "cap", extra: { requested: 500, armed: 440 } }, 1);
    expect(e.extra).toEqual({ requested: 500, armed: 440 });
  });

  it("clamps an oversized message/stack so one entry can't blow the quota", () => {
    const big = "x".repeat(5000);
    const e = toEntry({ kind: "k", message: big, stack: big }, 1);
    expect(e.message.length).toBe(2000);
    expect(e.stack?.length).toBe(2000);
  });
});

describe("parseLog", () => {
  it("survives missing or corrupt storage", () => {
    expect(parseLog(null)).toEqual([]);
    expect(parseLog("")).toEqual([]);
    expect(parseLog("{not json")).toEqual([]);
    expect(parseLog("null")).toEqual([]);
    expect(parseLog('{"not":"an array"}')).toEqual([]);
  });

  it("reads back a stored array", () => {
    const log = [entry(1), entry(2)];
    expect(parseLog(JSON.stringify(log))).toEqual(log);
  });
});

describe("appendEntry", () => {
  it("appends newest last", () => {
    const out = appendEntry([entry(1)], entry(2));
    expect(out.map((e) => e.ts)).toEqual([1, 2]);
  });

  it("evicts the oldest once the cap is exceeded", () => {
    let log: ErrorEntry[] = [];
    for (let i = 0; i < 60; i++) log = appendEntry(log, entry(i));
    expect(log.length).toBe(50);
    // The 10 oldest (0..9) were evicted; newest (59) is last.
    expect(log[0].ts).toBe(10);
    expect(log[log.length - 1].ts).toBe(59);
  });

  it("respects a custom max", () => {
    const out = appendEntry([entry(1), entry(2), entry(3)], entry(4), 2);
    expect(out.map((e) => e.ts)).toEqual([3, 4]);
  });

  it("does not mutate the input list", () => {
    const log = [entry(1)];
    appendEntry(log, entry(2));
    expect(log.map((e) => e.ts)).toEqual([1]);
  });
});
