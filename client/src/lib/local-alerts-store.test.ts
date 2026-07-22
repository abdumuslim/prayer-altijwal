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

});

// The 10-min default older builds seeded on first launch is being retired
// (user, 2026-07-22). Devices that ran those builds carry the historical seed
// marker + the rule itself; the migration removes it ONCE, and only while it is
// still untouched.
describe("migrateRemoveSeededDefault", () => {
  const SEED_KEY = "prayer.alerts.seeded.v1";
  const MIGRATION_KEY = "prayer.alerts.default-removed.v1";

  /** Reproduce a device seeded by an older build: marker + the rule at id 1. */
  function seedLikeOldBuild(rule: Omit<LocalAlertRule, "id"> = DEFAULT_RULE): void {
    store.set(SEED_KEY, "1");
    store.set("prayer.alerts.v1", JSON.stringify([{ ...rule, id: 1 }]));
  }

  test("removes the untouched seeded default", async () => {
    seedLikeOldBuild();
    const s = await freshStore();
    expect(s.getLocalAlerts()).toHaveLength(1);

    s.migrateRemoveSeededDefault();

    expect(s.getLocalAlerts()).toHaveLength(0);
    expect(JSON.parse(store.get("prayer.alerts.v1")!)).toHaveLength(0);
    expect(store.get(MIGRATION_KEY)).toBe("1");
  });

  test("ignores prayer ORDER (the editor rewrites it) but not membership", async () => {
    seedLikeOldBuild({ ...DEFAULT_RULE, prayers: ["isha", "fajr", "maghrib", "dhuhr", "asr"] });
    const s = await freshStore();
    s.migrateRemoveSeededDefault();
    expect(s.getLocalAlerts()).toHaveLength(0);
  });

  test.each([
    ["different minutes", { ...DEFAULT_RULE, minutes: 5 }],
    ["fewer prayers", { ...DEFAULT_RULE, prayers: ["fajr"] as LocalAlertRule["prayers"] }],
    ["alarm kind", { ...DEFAULT_RULE, kind: "alarm" as const }],
    ["different timing", { ...DEFAULT_RULE, timing: "after" as const }],
  ])("keeps a user-modified rule (%s)", async (_label, rule) => {
    seedLikeOldBuild(rule);
    const s = await freshStore();
    s.migrateRemoveSeededDefault();
    expect(s.getLocalAlerts()).toHaveLength(1);
  });

  test("keeps a matching rule the user created later (id != 1)", async () => {
    store.set(SEED_KEY, "1");
    store.set("prayer.alerts.v1", JSON.stringify([{ ...DEFAULT_RULE, id: 7 }]));
    const s = await freshStore();
    s.migrateRemoveSeededDefault();
    expect(s.getLocalAlerts()).toHaveLength(1);
  });

  test("runs at most once — a rule re-created afterwards survives", async () => {
    seedLikeOldBuild();
    const s = await freshStore();
    s.migrateRemoveSeededDefault();
    expect(s.getLocalAlerts()).toHaveLength(0);

    s.addRule(DEFAULT_RULE); // user makes the same rule again, deliberately
    s.migrateRemoveSeededDefault();
    expect(s.getLocalAlerts()).toHaveLength(1);
  });

  test("no-op on a fresh install (never seeded), and it does not seed anything", async () => {
    const s = await freshStore();
    s.migrateRemoveSeededDefault();
    expect(s.getLocalAlerts()).toHaveLength(0);
    expect(store.get(MIGRATION_KEY)).toBe("1");
  });

  test("survives disabled storage without touching the rules", async () => {
    seedLikeOldBuild();
    const s = await freshStore();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => {},
      clear: () => {},
    });

    expect(() => s.migrateRemoveSeededDefault()).not.toThrow();
    expect(s.getLocalAlerts()).toHaveLength(1);
  });
});
