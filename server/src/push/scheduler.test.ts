import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrayerScheduler, qiyamAnchorForDay } from "./scheduler.js";
import { dateKey } from "../prayer/format.js";
import type {
  SubscriptionsRepo,
  Subscription,
  SubscriptionPrefs,
} from "../db/repositories/subscriptions.js";
import type {
  AlertRule,
  AlertRuleInput,
  AlertRulesRepo,
  CreateAlertResult,
} from "../db/repositories/alert-rules.js";
import type { PushLogRepo } from "../db/repositories/push-log.js";
import type { PushStatDelta, PushStatsRepo } from "../db/repositories/push-stats.js";
import type { SendResult, PushSendOptions } from "./webpush.js";

type SendFn = (
  subscription: unknown,
  payload: object,
  options?: PushSendOptions,
) => Promise<SendResult>;

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
  async deleteById(): Promise<boolean> {
    return false; // admin-only path; the scheduler never deletes by id
  }
  async updatePrefs(endpoint: string, prefs: SubscriptionPrefs): Promise<void> {
    this.subs = this.subs.map((s) => (s.endpoint === endpoint ? { ...s, ...prefs } : s));
  }
  async listAll(): Promise<Subscription[]> {
    return this.subs;
  }
}

class FakeAlertRulesRepo implements AlertRulesRepo {
  private seq = 0;
  constructor(public rules: AlertRule[] = []) {
    this.seq = rules.reduce((m, r) => Math.max(m, r.id), 0);
  }
  async listByEndpoint(endpoint: string): Promise<AlertRule[]> {
    return this.rules.filter((r) => r.endpoint === endpoint);
  }
  async listAll(): Promise<AlertRule[]> {
    return this.rules;
  }
  async create(input: AlertRuleInput): Promise<CreateAlertResult> {
    const rule = { id: ++this.seq, ...input };
    this.rules.push(rule);
    return { ok: true, rule };
  }
  async update(
    id: number,
    endpoint: string,
    patch: Pick<AlertRuleInput, "timing" | "minutes" | "prayers" | "kind">,
  ): Promise<AlertRule | null> {
    const rule = this.rules.find((r) => r.id === id && r.endpoint === endpoint);
    if (!rule) return null;
    Object.assign(rule, patch);
    return rule;
  }
  async delete(id: number, endpoint: string): Promise<void> {
    this.rules = this.rules.filter((r) => !(r.id === id && r.endpoint === endpoint));
  }
}

const ALL_PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

const EP1 = "https://fcm.googleapis.com/fcm/send/ep1";

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    endpoint: EP1,
    subscription: { endpoint: EP1, keys: { p256dh: "p", auth: "a" } },
    lat: 33.32,
    lon: 44.36,
    tz: "Asia/Baghdad",
    country: "IQ",
    method: "BaghdadYMA",
    asr: "Standard",
    leadMinutes: [0],
    prayers: ALL_PRAYERS,
    lang: "ar",
    ...overrides,
  };
}

function makeRule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 1,
    endpoint: EP1,
    timing: "at_time",
    minutes: null,
    prayers: ALL_PRAYERS,
    kind: "notification",
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
    // Sunnah / adhkar anchors — duha is "due" (== NOW); the rest are far away.
    duha: DHUHR,
    qiyam: new Date("2026-06-19T00:30:00.000Z"),
    adhkar_morning: new Date("2026-06-19T01:00:00.000Z"),
    adhkar_evening: new Date("2026-06-19T12:00:00.000Z"),
  };
}

describe("qiyamAnchorForDay", () => {
  const tz = "Asia/Baghdad";
  // Baghdad-ish: maghrib ~18:40 local (15:40Z), fajr ~03:00 local (00:00Z).
  const prevMaghrib = new Date("2026-06-18T15:40:00.000Z");
  const fajr = new Date("2026-06-19T00:00:00.000Z");
  const maghrib = new Date("2026-06-19T15:40:00.000Z");
  const nextFajr = new Date("2026-06-20T00:00:00.000Z");

  it("returns the last-third instant that falls on the requested civil day", () => {
    const anchor = qiyamAnchorForDay(prevMaghrib, fajr, maghrib, nextFajr, "2026-06-19", tz);
    expect(anchor).not.toBeNull();
    expect(dateKey(anchor as Date, tz)).toBe("2026-06-19");
  });

  it("returns null when neither candidate lands on the day", () => {
    expect(qiyamAnchorForDay(prevMaghrib, fajr, maghrib, nextFajr, "2030-01-01", tz)).toBeNull();
  });

  it("returns null on invalid (high-latitude NaN) inputs", () => {
    const nan = new Date(NaN);
    expect(qiyamAnchorForDay(nan, nan, nan, nan, "2026-06-19", tz)).toBeNull();
  });
});

describe("PrayerScheduler", () => {
  let send: ReturnType<typeof vi.fn<SendFn>>;

  beforeEach(() => {
    send = vi.fn<SendFn>(async () => ({ ok: true, gone: false }));
  });

  // (a) exactly one fire per rule/prayer/day across repeated ticks
  it("fires exactly once per rule/prayer/day across repeated ticks", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule()]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
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
      undefined,
    );
  });

  // Alarm rules carry kind:"alarm" in the payload and high-urgency/short-TTL opts.
  it("sends an alarm rule with kind:'alarm' and high-urgency, short-TTL options", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule({ kind: "alarm" })]);
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();

    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prayer: "dhuhr", kind: "alarm" }),
      { urgency: "high", TTL: 600 },
    );
  });

  // Plain notification rules carry kind:"notification" and NO send options.
  it("sends a notification rule with kind:'notification' and no send options", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule({ kind: "notification" })]);
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();

    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prayer: "dhuhr", kind: "notification" }),
      undefined,
    );
  });

  it("a subscription with no rules never fires", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([]); // no reminders configured
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });
    await scheduler.tick();
    expect(send).not.toHaveBeenCalled();
  });

  it("skips invalid (NaN) prayer times", async () => {
    // Make isha "due" but NaN — it must never fire.
    const table = { ...fixedTable(), isha: new Date(NaN) };
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule({ prayers: ["isha"] })]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
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
    const rulesRepo = new FakeAlertRulesRepo([makeRule()]);

    const first = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
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
      alertRulesRepo: rulesRepo,
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
    const epA = "https://fcm.googleapis.com/fcm/send/A";
    const epB = "https://fcm.googleapis.com/fcm/send/B";
    const subA = makeSub({
      endpoint: epA,
      tz: "Asia/Baghdad",
      subscription: { endpoint: epA, keys: { p256dh: "p", auth: "a" } },
    });
    const subB = makeSub({
      endpoint: epB,
      tz: "America/New_York",
      subscription: { endpoint: epB, keys: { p256dh: "p", auth: "a" } },
    });
    const subsRepo = new FakeSubscriptionsRepo([subA, subB]);
    const rulesRepo = new FakeAlertRulesRepo([
      makeRule({ id: 1, endpoint: epA }),
      makeRule({ id: 2, endpoint: epB }),
    ]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
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
    expect(endpoints).toEqual([
      "https://fcm.googleapis.com/fcm/send/A",
      "https://fcm.googleapis.com/fcm/send/B",
    ]);

    // Their dedup keys are distinct (different local dates may apply, but
    // endpoints differ regardless), proving independent schedules.
    expect(logRepo.seen.size).toBe(2);
  });

  it("fires a duha rule when duha is due", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule({ prayers: ["duha"] })]);
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prayer: "duha", lead: 0 }),
      undefined,
    );
  });

  it("an 'after' rule fires N minutes after the prayer, not at it", async () => {
    // A rule "adhkar_morning, 30 min after". adhkar_morning is at 01:00Z; it must
    // fire at 01:30Z (lead −30 in window) and NOT at 01:00Z.
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([
      makeRule({ timing: "after", minutes: 30, prayers: ["adhkar_morning"] }),
    ]);
    const logRepo = new FakePushLogRepo();

    // At the prayer time exactly → not yet due for an "after" alert.
    const atPrayer = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo,
      now: () => new Date("2026-06-19T01:00:00.000Z"),
      computeTimes: () => fixedTable(),
      send,
    });
    await atPrayer.tick();
    expect(send).not.toHaveBeenCalled();

    // 30 min later → in the arming window.
    const after = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo,
      now: () => new Date("2026-06-19T01:30:00.000Z"),
      computeTimes: () => fixedTable(),
      send,
    });
    await after.tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prayer: "adhkar_morning", lead: -30 }),
      undefined,
    );
  });

  it("silently skips an unknown target that slipped past validation", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule({ prayers: ["not_a_prayer"] })]);
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });
    await scheduler.tick();
    expect(send).not.toHaveBeenCalled();
  });

  it("fires across multiple rules for the same prayer", async () => {
    // dhuhr is exactly due (minutesLeft=0). Two rules: at_time (lead 0; 0<=0,
    // 0>-1.5) and before-1min (lead 1; 0<=1, 0>-0.5) — both in-window, and their
    // per-rule fireKeys are distinct → two sends.
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([
      makeRule({ id: 1, timing: "at_time" }),
      makeRule({ id: 2, timing: "before", minutes: 1 }),
    ]);
    const logRepo = new FakePushLogRepo();
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
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
    const rulesRepo = new FakeAlertRulesRepo([makeRule()]);
    const logRepo = new FakePushLogRepo();
    const goneSend = vi.fn<SendFn>(async () => ({ ok: false, gone: true }));
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
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

  // Defence in depth: a stored endpoint that isn't a known push service (e.g. an
  // internal address left over from before the allowlist) is never POSTed to —
  // it is purged like a dead subscription instead.
  it("purges (never sends to) a subscription whose endpoint is disallowed", async () => {
    const evil = "https://169.254.169.254/steal";
    const sub = makeSub({
      endpoint: evil,
      subscription: { endpoint: evil, keys: { p256dh: "p", auth: "a" } },
    });
    const subsRepo = new FakeSubscriptionsRepo([sub]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule({ endpoint: evil })]);
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();

    expect(send).not.toHaveBeenCalled();
    expect((await subsRepo.listAll()).length).toBe(0);
    expect(scheduler.stats().goneRemovedToday).toBe(1);
  });

  // SSRF depth: the send guard validates the actual POST target (the JSONB
  // `subscription`), not just the endpoint column. A hand-crafted row can keep an
  // allowlisted column while the JSONB endpoint diverges; that must be purged,
  // never dialed, even when the JSONB endpoint is itself an allowlisted host.
  it("purges a row whose JSONB subscription endpoint differs from the column", async () => {
    const sub = makeSub({
      endpoint: EP1, // column: the legitimate, allowlisted endpoint
      subscription: {
        endpoint: "https://fcm.googleapis.com/fcm/send/OTHER", // diverges from the column
        keys: { p256dh: "p", auth: "a" },
      },
    });
    const subsRepo = new FakeSubscriptionsRepo([sub]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule()]);
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();

    expect(send).not.toHaveBeenCalled();
    expect((await subsRepo.listAll()).length).toBe(0);
    expect(scheduler.stats().goneRemovedToday).toBe(1);
  });

  it("start() runs an immediate tick and stop() halts the timer", async () => {
    vi.useFakeTimers();
    try {
      const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
      const rulesRepo = new FakeAlertRulesRepo([makeRule()]);
      const logRepo = new FakePushLogRepo();
      const scheduler = new PrayerScheduler({
        subsRepo,
        alertRulesRepo: rulesRepo,
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

  // Single-flight: a still-running tick makes the next one skip, so a slow scan
  // can't overlap itself and double the DB load / race the shared caches.
  it("skips an overlapping tick while a slow one is still running", async () => {
    const subsRepo = new FakeSubscriptionsRepo([makeSub()]);
    const rulesRepo = new FakeAlertRulesRepo([makeRule()]);
    // Gate the first tick's load so a second tick.tick() overlaps it.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let listCalls = 0;
    const base = subsRepo.listAll.bind(subsRepo);
    subsRepo.listAll = async () => {
      listCalls += 1;
      await gate;
      return base();
    };
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    const first = scheduler.tick(); // runs, blocks on the gate
    await scheduler.tick(); // overlaps → skipped before it can load
    expect(listCalls).toBe(1); // the second tick never reached the load

    release();
    await first;
    expect(send).toHaveBeenCalledTimes(1);
  });

  // The per-endpoint table cache must not grow forever as subscriptions churn.
  it("prunes cached tables for subscriptions that have churned away", async () => {
    const epA = "https://fcm.googleapis.com/fcm/send/A";
    const epB = "https://fcm.googleapis.com/fcm/send/B";
    const subA = makeSub({
      endpoint: epA,
      subscription: { endpoint: epA, keys: { p256dh: "p", auth: "a" } },
    });
    const subB = makeSub({
      endpoint: epB,
      subscription: { endpoint: epB, keys: { p256dh: "p", auth: "a" } },
    });
    const subsRepo = new FakeSubscriptionsRepo([subA, subB]);
    const rulesRepo = new FakeAlertRulesRepo([
      makeRule({ id: 1, endpoint: epA }),
      makeRule({ id: 2, endpoint: epB }),
    ]);
    const scheduler = new PrayerScheduler({
      subsRepo,
      alertRulesRepo: rulesRepo,
      logRepo: new FakePushLogRepo(),
      now: () => NOW,
      computeTimes: () => fixedTable(),
      send,
    });

    await scheduler.tick();
    expect(scheduler.cacheSize()).toBe(2);

    // B unsubscribes; its cache entry must be reclaimed, not linger forever.
    await subsRepo.deleteByEndpoint(epB);
    await scheduler.tick();
    expect(scheduler.cacheSize()).toBe(1);
  });
});

// The dashboard's delivery numbers. push_log is pruned at 48h, so these
// counters (in memory) and the push_stats rollup (durable) are the only record
// of how much actually went out.
describe("PrayerScheduler delivery counters", () => {
  function setup(sendImpl: SendFn, now: () => Date = () => NOW) {
    const written: PushStatDelta[][] = [];
    const statsRepo: PushStatsRepo = {
      async add(deltas) {
        written.push(deltas);
      },
      async prune() {
        return 0;
      },
    };
    const scheduler = new PrayerScheduler({
      subsRepo: new FakeSubscriptionsRepo([makeSub()]),
      alertRulesRepo: new FakeAlertRulesRepo([makeRule()]),
      logRepo: new FakePushLogRepo(),
      now,
      computeTimes: () => fixedTable(),
      send: vi.fn<SendFn>(sendImpl),
      statsRepo,
    });
    return { scheduler, written };
  }

  it("counts a successful send and rolls it up durably", async () => {
    const { scheduler, written } = setup(async () => ({ ok: true, gone: false }));
    await scheduler.tick();

    const stats = scheduler.stats();
    expect(stats.sentToday).toBe(1);
    expect(stats.failedToday).toBe(0);
    expect(stats.goneRemovedToday).toBe(0);
    expect(stats.lastTickAt).toBe(NOW.toISOString());
    expect(written).toEqual([
      [{ day: "2026-06-19", kind: "notification", outcome: "sent", n: 1 }],
    ]);
  });

  it("counts a failed send separately from a successful one", async () => {
    const { scheduler } = setup(async () => ({ ok: false, gone: false }));
    await scheduler.tick();
    expect(scheduler.stats().failedToday).toBe(1);
    expect(scheduler.stats().sentToday).toBe(0);
  });

  it("counts a dead endpoint as 'gone', not as a send", async () => {
    const { scheduler, written } = setup(async () => ({ ok: false, gone: true }));
    await scheduler.tick();
    expect(scheduler.stats().goneRemovedToday).toBe(1);
    expect(scheduler.stats().sentToday).toBe(0);
    expect(written[0]?.[0]?.outcome).toBe("gone");
  });

  it("reports zeros once the UTC day has rolled over", async () => {
    let clock = NOW;
    const { scheduler } = setup(
      async () => ({ ok: true, gone: false }),
      () => clock,
    );
    await scheduler.tick();
    expect(scheduler.stats().sentToday).toBe(1);

    // Next day, before anything new has fired: yesterday's total must not linger.
    clock = new Date("2026-06-20T09:00:00.000Z");
    expect(scheduler.stats().sentToday).toBe(0);
  });

  it("does not write an empty batch when nothing fired", async () => {
    const { scheduler, written } = setup(async () => ({ ok: true, gone: false }));
    await scheduler.tick(); // fires dhuhr
    await scheduler.tick(); // deduped by the ledger — nothing new
    expect(written).toHaveLength(1);
  });
});
