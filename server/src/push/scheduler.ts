import { childLogger } from "../logger.js";
import { dateKey, isValidDate } from "../prayer/format.js";
import { computePrayerTimes } from "../prayer/compute.js";
import type { SubscriptionsRepo, Subscription } from "../db/repositories/subscriptions.js";
import type { PushLogRepo } from "../db/repositories/push-log.js";
import { sendPush, type SendResult } from "./webpush.js";
import type { MethodName, AsrMadhab } from "../prayer-engine/index.js";

const log = childLogger("push/scheduler");

const MIN_MS = 60_000;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_ARMING_WINDOW_MIN = 1.5;
/** Keep ~48h of ledger so a restart can still see "already fired" for today/yesterday. */
const PRUNE_OLDER_THAN_MS = 48 * 60 * MIN_MS;

/** The six core prayers the scheduler can fire (sunrise is informational only). */
const SCHEDULABLE = ["fajr", "dhuhr", "asr", "maghrib", "isha"] as const;
const SCHEDULABLE_SET = new Set<string>(SCHEDULABLE);

/** A subscriber's six computed times for one local civil day. */
type PrayerTimeMap = Record<string, Date>;

interface CachedTimes {
  dateKey: string;
  table: PrayerTimeMap;
}

export interface SchedulerDeps {
  subsRepo: SubscriptionsRepo;
  logRepo: PushLogRepo;
  /** Injectable clock (tests pass a fixed/advancing fake). Default: real time. */
  now?: () => Date;
  /** Injectable time computation (tests return fixed Dates). */
  computeTimes?: (sub: Subscription) => PrayerTimeMap;
  /** Injectable sender (tests spy on this). */
  send?: (subscription: unknown, payload: object) => Promise<SendResult>;
  /** Tick interval in ms. Default 30000. */
  tickMs?: number;
  /**
   * Arming window in minutes — must exceed the tick interval so no fire is
   * skipped between ticks. The DB dedup absorbs the resulting duplicate hits.
   */
  armingWindowMin?: number;
}

/** Default time computation: each subscriber's six times for the current instant in THEIR tz. */
function defaultComputeTimes(sub: Subscription, now: Date): PrayerTimeMap {
  const t = computePrayerTimes({
    lat: sub.lat,
    lon: sub.lon,
    tz: sub.tz,
    method: sub.method as MethodName,
    asr: sub.asr as AsrMadhab,
    date: now,
  });
  return {
    fajr: t.fajr,
    dhuhr: t.dhuhr,
    asr: t.asr,
    maghrib: t.maghrib,
    isha: t.isha,
  };
}

/**
 * Restart-safe, per-tz prayer reminder scheduler. Every tick it walks all
 * subscriptions, computes (and caches) their local-day prayer table, and for
 * each selected prayer × lead checks whether `now` is inside the arming window;
 * if so it claims a fire via the persistent ledger and sends. See
 * docs/NOTIFICATIONS.md §4 for the full design and the three multi-location
 * fixes over home's single-table scheduler.
 */
export class PrayerScheduler {
  private readonly subsRepo: SubscriptionsRepo;
  private readonly logRepo: PushLogRepo;
  private readonly now: () => Date;
  private readonly computeTimes: (sub: Subscription) => PrayerTimeMap;
  private readonly send: (subscription: unknown, payload: object) => Promise<SendResult>;
  private readonly tickMs: number;
  private readonly armingWindowMin: number;

  /** Per-endpoint cache of the current local day's table (recomputed at rollover). */
  private readonly cache = new Map<string, CachedTimes>();
  /** The last local date we pruned on — prune at most once per local day. */
  private lastPruneDateKey: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: SchedulerDeps) {
    this.subsRepo = deps.subsRepo;
    this.logRepo = deps.logRepo;
    this.now = deps.now ?? (() => new Date());
    this.send = deps.send ?? sendPush;
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.armingWindowMin = deps.armingWindowMin ?? DEFAULT_ARMING_WINDOW_MIN;
    // Bind the default clock into the default compute so callers get per-now tables.
    this.computeTimes =
      deps.computeTimes ?? ((sub: Subscription) => defaultComputeTimes(sub, this.now()));
  }

  /** Begin ticking. Runs one tick immediately, then every `tickMs`. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    log.info("Scheduler started", { tickMs: this.tickMs, armingWindowMin: this.armingWindowMin });
    void this.tick();
  }

  /** Stop ticking. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info("Scheduler stopped");
    }
  }

  /** Look up (or recompute on local-midnight rollover) a subscriber's table. */
  private tableFor(sub: Subscription, localDateKey: string): PrayerTimeMap {
    const cached = this.cache.get(sub.endpoint);
    if (cached && cached.dateKey === localDateKey) return cached.table;
    const table = this.computeTimes(sub);
    this.cache.set(sub.endpoint, { dateKey: localDateKey, table });
    return table;
  }

  /**
   * One scheduling pass. Public so tests can drive it directly with an injected
   * clock — no real timer needed. Errors per-subscription are isolated so one
   * bad subscriber can't stall the rest of the tick.
   */
  async tick(): Promise<void> {
    const now = this.now();
    let subs: Subscription[];
    try {
      subs = await this.subsRepo.listAll();
    } catch (error: unknown) {
      log.error("Tick: failed to list subscriptions", error instanceof Error ? error : { error });
      return;
    }

    for (const sub of subs) {
      try {
        await this.processSubscription(sub, now);
      } catch (error: unknown) {
        log.error("Tick: subscription failed", { endpoint: sub.endpoint });
        log.error("Tick error detail", error instanceof Error ? error : { error });
      }
    }

    await this.maybePrune(now);
  }

  private async processSubscription(sub: Subscription, now: Date): Promise<void> {
    const localDateKey = dateKey(now, sub.tz);
    const table = this.tableFor(sub, localDateKey);
    const leads = sub.leadMinutes.length > 0 ? sub.leadMinutes : [0];

    for (const prayer of sub.prayers) {
      if (!SCHEDULABLE_SET.has(prayer)) continue;
      const t = table[prayer];
      if (!t || !isValidDate(t)) continue; // skip invalid / NaN times

      const minutesLeft = (t.getTime() - now.getTime()) / MIN_MS;
      for (const lead of leads) {
        // Arming window: fire once we're within `lead` minutes, but not before
        // (lead - armingWindow). Window > tick so no fire slips between ticks.
        if (minutesLeft <= lead && minutesLeft > lead - this.armingWindowMin) {
          const fireKey = `${localDateKey}-${prayer}-${lead}`;
          const won = await this.logRepo.tryClaim(sub.endpoint, fireKey);
          if (!won) continue; // already fired (this day) — restart/overlap safe
          await this.fire(sub, prayer, lead);
        }
      }
    }
  }

  private async fire(sub: Subscription, prayer: string, lead: number): Promise<void> {
    const payload = { prayer, lead, lang: sub.lang };
    const result = await this.send(sub.subscription, payload);
    if (result.gone) {
      // 404/410 → subscription is dead; delete it (cascades to its ledger rows).
      await this.subsRepo.deleteByEndpoint(sub.endpoint);
      this.cache.delete(sub.endpoint);
      log.info("Removed gone subscription", { endpoint: sub.endpoint });
    }
  }

  /** Prune the ledger at most once per (server-UTC) local day. */
  private async maybePrune(now: Date): Promise<void> {
    const key = dateKey(now, "UTC");
    if (key === this.lastPruneDateKey) return;
    this.lastPruneDateKey = key;
    try {
      await this.logRepo.prune(PRUNE_OLDER_THAN_MS);
    } catch (error: unknown) {
      log.error("Prune failed", error instanceof Error ? error : { error });
    }
  }
}
