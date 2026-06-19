import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrayerScheduler } from "./scheduler.js";
import type {
  SubscriptionsRepo,
  Subscription,
  SubscriptionPrefs,
} from "../db/repositories/subscriptions.js";
import type { PushLogRepo } from "../db/repositories/push-log.js";
import type { SendResult } from "./webpush.js";

type SendFn = (subscription: unknown, payload: object) => Promise<SendResult>;

// ---- In-memory fakes (no DB, no clock, no network) ------------------------

/** Mirrors the real `push_log` PK + ON CONFLICT DO NOTHING dedup with a Set. */
class FakePushLogRepo implements PushLogRepo {
  constructor(readonly seen: Set<string> = new Set()) {}
  async tryClaim(endpoint: string, fireKey: string): Promise<boolean> {
    const key = `${endpoint}|${fireKey}`;
    if (this.seen.has(key)) return false; // ON CONFLICT DO NOTHING → 0 rows
    this.seen.add(key);
    return true;
  }
  async prune(): Promise<void> {
    /* no-op for tests */
  }
}

class FakeSubscriptionsRepo implements SubscriptionsRepo {
  constructor(public subs: Subscription[]) {}
  async upsert(sub: Subscription): Promise<void> {
    this.subs = [...this.subs.filter((s) => s.endpoint !== sub.endpoint), sub];
  }
  async deleteByEndpoint(endpoint: string): Promise<void> {
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
  }
  async updatePrefs(endpoint: string, prefs: SubscriptionPrefs): Promise<void> {
    this.subs = this.subs.map((s) => (s.endpoint === endpoint ? { ...s, ...prefs } : s));
  }
  async listAll(): Promise<Subscription[]> {
    return this.subs;
  }
}

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    endpoint: "https://push.example/ep1",
    subscription: { endpoint: "https://push.example/ep1", keys: { p256dh: "p", auth: "a" } },
    lat: 33.32,
    lon: 44.36,
    tz: "Asia/Baghdad",
    country: "IQ",
    method: "BaghdadYMA",
    asr: "Standard",
    leadMinutes: [0],
    prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
    lang: "ar",
    ...overrides,
  };
}

// A fixed "now" and dhuhr exactly due (minutesLeft=0) so the lead-0 arming
// window (0 <= 0 and 0 > -1.5) catches it.
const NOW = new Date("2026-06-19T09:00:00.000Z");
const DHUHR = new Date("2026-06-19T09:00:00.000Z"); // == NOW → minutesLeft 0

function fixedTable(): Record<string, Date> {
  // Only dhuhr is "due"; the rest are far away (or NaN to test skip).
  return {
    fajr: new Date("2026-06-19T01:00:00.000Z"),
    dhuhr: DHUHR,
    asr: new Date("2026-06-19T12:00:00.000Z"),
    maghrib: new Date("2026-06-19T16:00:00.000Z"),
    isha: new Date(NaN), // invalid — must be skipped
  };
}

describe("PrayerScheduler", () => {
  let send: ReturnType<typeof vi.fn<SendFn>>;

  beforeEach(() => {
    send = vi.fn<SendFn>(async () => ({ ok: true, gone: false }));
  });

  // (a) exactly one fire per prayer/lead/day across repeated ticks
  it("fires exactly once per prayer/lead/day across repeated ticks", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      logRepo,
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    // dhuhr is in-window; the four other valid prayers are far off; isha is NaN.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prayer: "dhuhr", lead: 0, lang: "ar" }),
    );
  });

  it("skips invalid (NaN) prayer times", async () => {
    // Make isha "due" but NaN — it must never fire.
    const table = { ...fixedTable(), isha: new Date(NaN) };
    const subsRepo = new FakeSubscriptionsRepo([makeSub({ prayers: ["isha"] })]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      logRepo,
      now: () => NOW,
      computeTimes: () => table,
      send,
    });

    await scheduler.tick();
    expect(send).not.toHaveBeenCalled();
  });

  // (b) a SECOND scheduler sharing the SAME ledger does NOT re-fire after restart
  it("does not re-fire after a simulated restart (shared ledger, fresh caches)", async () => {
    const sharedSeen = new Set<string>();
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);

    const first = new PrayerScheduler({
      subsRepo,
      logRepo: new FakePushLogRepo(sharedSeen),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });
    await first.tick();
    expect(send).toHaveBeenCalledTimes(1);

    // Simulate a process restart: brand-new scheduler (fresh in-memory caches),
    // same persistent ledger (sharedSeen), same DB state.
    const second = new PrayerScheduler({
      subsRepo,
      logRepo: new FakePushLogRepo(sharedSeen),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });
    await second.tick();

    // No double-send: the ledger remembers the fire across the "restart".
    expect(send).toHaveBeenCalledTimes(1);
  });

  // (c) two subscribers in different tz each fire on their own local schedule
  it("two subscribers in different tz fire on their own local schedule", async () => {
    // Both have dhuhr at NOW+1min, but different tz → different localDateKey →
    // independent fireKeys; both must fire exactly once.
    const subA = makeSub({
      endpoint: "https://push.example/A",
      tz: "Asia/Baghdad",
      subscription: { endpoint: "https://push.example/A", keys: { p256dh: "p", auth: "a" } },
    });
    const subB = makeSub({
      endpoint: "https://push.example/B",
      tz: "America/New_York",
      subscription: { endpoint: "https://push.example/B", keys: { p256dh: "p", auth: "a" } },
    });
    const subsRepo = new FakeSubscriptionsRepo([subA, subB]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      logRepo,
      now: () => NOW,
      // Each subscriber gets a table with dhuhr due; reuse fixedTable.
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();
    await scheduler.tick(); // dedup holds

    expect(send).toHaveBeenCalledTimes(2);
    const endpoints = send.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
    expect(endpoints).toEqual(["https://push.example/A", "https://push.example/B"]);

    // Their dedup keys are distinct (different local dates may apply, but
    // endpoints differ regardless), proving independent schedules.
    expect(logRepo.seen.size).toBe(2);
  });

  it("fires across multiple leads for the same prayer", async () => {
    // dhuhr is exactly due (minutesLeft=0). leads [0, 1]: lead=0 (0<=0, 0>-1.5)
    // and lead=1 (0<=1, 0>-0.5) are BOTH in-window → two distinct fireKeys.
    const subsRepo = new FakeSubscriptionsRepo([makeSub({ leadMinutes: [0, 1] })]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      logRepo,
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();
    await scheduler.tick(); // dedup holds across ticks

    expect(send).toHaveBeenCalledTimes(2);
    const leads = send.mock.calls.map((c) => (c[1] as { lead: number }).lead).sort();
    expect(leads).toEqual([0, 1]);
  });

  // (d) a {gone:true} send result deletes that subscription
  it("deletes a subscription when send reports gone (404/410)", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const logRepo = new FakePushLogRepo();
    const goneSend = vi.fn<SendFn>(async () => ({ ok: false, gone: true }));
    const scheduler = new PrayerScheduler({
      subsRepo,
      logRepo,
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send: goneSend,
    });

    expect((await subsRepo.listAll()).length).toBe(1);
    await scheduler.tick();

    expect(goneSend).toHaveBeenCalledTimes(1);
    expect((await subsRepo.listAll()).length).toBe(0);
  });

  it("start() runs an immediate tick and stop() halts the timer", async () => {
    vi.useFakeTimers();
    try {
      const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
      const logRepo = new FakePushLogRepo();
      const scheduler = new PrayerScheduler({
        subsRepo,
        logRepo,
        now: () => NOW,
        computeTimes: () => fixedTable(),
        send,
        tickMs: 1000,
      });

      scheduler.start();
      // Immediate tick is async (void this.tick()); flush microtasks.
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

      scheduler.stop();
      await vi.advanceTimersByTimeAsync(5000);
      // Still 1 — dedup blocks re-fire anyway, and timer is cleared.
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
