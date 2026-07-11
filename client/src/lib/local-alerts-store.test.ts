import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { LocalAlertRule } from "./local-alerts";

// The store initializes its snapshot from localStorage at import time and each
// mutator persists back, so every test imports a FRESH module (vi.resetModules)
// bound to a clean in-memory localStorage stub.

type Store = typeof import("./local-alerts-store");

let store: Map<string, string>;

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import("./local-alerts-store");
}

const DEFAULT_RULE: Omit<LocalAlertRule, "id"> = {
  timing: "before",
  minutes: 10,
  prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
  kind: "notification",
};

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

describe("local-alerts-store", () => {
  test("a single addRule notifies every subscriber once and changes the snapshot ref", async () => {
    const s = await freshStore();
    let a = 0;
    let b = 0;
    const unsubA = s.subscribeLocalAlerts(() => (a += 1));
    const unsubB = s.subscribeLocalAlerts(() => (b += 1));

    const before = s.getLocalAlerts();
    s.addRule(DEFAULT_RULE);
    const after = s.getLocalAlerts();

    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(after).not.toBe(before); // new reference
    expect(after).toHaveLength(before.length + 1);

    unsubA();
    unsubB();
    s.addRule(DEFAULT_RULE);
    expect(a).toBe(1); // no longer notified after unsubscribe
    expect(b).toBe(1);
  });

  test("getLocalAlerts returns a stable reference until a mutation (no getSnapshot loop)", async () => {
    const s = await freshStore();
    const r1 = s.getLocalAlerts();
    const r2 = s.getLocalAlerts();
    expect(r2).toBe(r1);

    s.addRule(DEFAULT_RULE);
    const r3 = s.getLocalAlerts();
    expect(r3).not.toBe(r1);
    expect(s.getLocalAlerts()).toBe(r3); // stable again after the mutation
  });

  test("mutations persist to localStorage", async () => {
    const s = await freshStore();
    s.addRule(DEFAULT_RULE);
    const raw = store.get("prayer.alerts.v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });

  test("seedDefaultLocalAlerts seeds one default when empty and is idempotent", async () => {
    const s = await freshStore();
    expect(s.getLocalAlerts()).toHaveLength(0);

    s.seedDefaultLocalAlerts();
    const rules = s.getLocalAlerts();
    expect(rules).toHaveLength(1);
    expect(rules[0].prayers).toEqual(["fajr", "dhuhr", "asr", "maghrib", "isha"]);
    expect(rules[0].kind).toBe("notification");
    expect(rules[0].minutes).toBe(10);

    s.seedDefaultLocalAlerts(); // second call is a no-op
    expect(s.getLocalAlerts()).toHaveLength(1);
  });

  test("seedDefaultLocalAlerts does NOT re-seed after the user deletes every rule", async () => {
    const s = await freshStore();
    s.seedDefaultLocalAlerts();
    const id = s.getLocalAlerts()[0].id;

    s.removeRule(id);
    expect(s.getLocalAlerts()).toHaveLength(0);

    s.seedDefaultLocalAlerts(); // marker already set → stays empty
    expect(s.getLocalAlerts()).toHaveLength(0);
  });

  test("seedDefaultLocalAlerts leaves existing rules untouched", async () => {
    const s = await freshStore();
    s.addRule({ ...DEFAULT_RULE, minutes: 5, prayers: ["fajr"] });
    s.seedDefaultLocalAlerts();
    const rules = s.getLocalAlerts();
    expect(rules).toHaveLength(1); // did not add the 5-fard default on top
    expect(rules[0].minutes).toBe(5);
  });
});
