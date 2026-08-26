import { childLogger } from "../logger.js";
import { dateKey, isValidDate } from "../prayer/format.js";
import { computePrayerTimes } from "../prayer/compute.js";
import { duhaWindow, nightThird } from "../prayer-engine/sunnah.js";
import type { SubscriptionsRepo, Subscription } from "../db/repositories/subscriptions.js";
import { redactEndpoint } from "../db/repositories/subscriptions.js";
import { isAllowedPushEndpoint, PushSubscriptionSchema } from "../validation/push.js";
import type { AlertRule, AlertRulesRepo, AlertKind } from "../db/repositories/alert-rules.js";
import type { PushLogRepo } from "../db/repositories/push-log.js";
import type {
  PushOutcome,
  PushStatDelta,
  PushStatsRepo,
} from "../db/repositories/push-stats.js";
import { sendPush, type SendResult, type PushSendOptions } from "./webpush.js";
import { buildPushPayload } from "./notification-text.js";
import type { MethodName, AsrMadhab } from "../prayer-engine/index.js";

const log = childLogger("push/scheduler");

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_ARMING_WINDOW_MIN = 1.5;
/** Keep ~48h of ledger so a restart can still see "already fired" for today/yesterday. */
const PRUNE_OLDER_THAN_MS = 48 * 60 * MIN_MS;

/**
 * Targets the scheduler can fire (sunrise stays informational only). Beyond the
 * five fard: the Duha window's start, the last-third-of-night start (qiyam), and
 * the morning/evening adhkar anchors (fajr/asr). See computeDefaultTable.
 */
const SCHEDULABLE = [
  "fajr",
  "dhuhr",
  "asr",
  "maghrib",
  "isha",
  "duha",
  "qiyam",
  "adhkar_morning",
  "adhkar_evening",
] as const;
const SCHEDULABLE_SET = new Set<string>(SCHEDULABLE);

/** A subscriber's schedulable anchor instants for one local civil day. */
type PrayerTimeMap = Record<string, Date>;

/**
 * What the admin dashboard shows about delivery. Counters are per server-UTC
 * day and reset at rollover, so "today" always means today.
 */
export interface SchedulerSnapshot {
  running: boolean;
  lastTickAt: string | null;
  lastTickMs: number | null;
  sentToday: number;
  failedToday: number;
  goneRemovedToday: number;
}

interface CachedTimes {
  dateKey: string;
  table: PrayerTimeMap;
  /** Previous civil day's table, retained so an "after" rule whose (prayer +
      offset) instant has crossed local midnight can still resolve yesterday's
      prayer. Only populated once a rollover has been observed. */
  prevDateKey?: string;
  prevTable?: PrayerTimeMap;
}

/** Signed lead in minutes: 0 at-time, +N "before", −N "after". */
function leadFor(rule: AlertRule): number {
  if (rule.timing === "at_time") return 0;
  const m = Math.max(0, rule.minutes ?? 0);
  return rule.timing === "after" ? -m : m;
}

/** True when `instant` falls on a Friday in the given tz (5 = Friday). */
function isFridayInTz(instant: Date, tz: string): boolean {
  return new Date(`${dateKey(instant, tz)}T00:00:00Z`).getUTCDay() === 5;
}

export interface SchedulerDeps {
  subsRepo: SubscriptionsRepo;
  alertRulesRepo: AlertRulesRepo;
  logRepo: PushLogRepo;
  /** Injectable clock (tests pass a fixed/advancing fake). Default: real time. */
  now?: () => Date;
  /** Injectable time computation (tests return fixed Dates). */
  computeTimes?: (sub: Subscription) => PrayerTimeMap;
  /** Injectable sender (tests spy on this). */
  send?: (subscription: unknown, payload: object, options?: PushSendOptions) => Promise<SendResult>;
  /** Tick interval in ms. Default 30000. */
  tickMs?: number;
  /**
   * Arming window in minutes — must exceed the tick interval so no fire is
   * skipped between ticks. The DB dedup absorbs the resulting duplicate hits.
   */
  armingWindowMin?: number;
  /**
   * Durable delivery rollup for the admin dashboard. Optional: without it the
   * scheduler still counts in memory, it just loses the history on restart.
   */
  statsRepo?: PushStatsRepo;
}

/**
 * The last-third-of-night start (tahajjud window) that falls on the civil day
 * `dayKey` in `tz`, or null. Two candidates are possible near midnight: last
 * night's third (yesterday.maghrib → today.fajr, lands in the early hours of
 * today) and tonight's (today.maghrib → tomorrow.fajr, lands after midnight —
 * i.e. tomorrow). The one whose civil date equals `dayKey` is the day's anchor.
 */
export function qiyamAnchorForDay(
  prevMaghrib: Date,
  fajr: Date,
  maghrib: Date,
  nextFajr: Date,
  dayKey: string,
  tz: string,
): Date | null {
  const candidates = [
    nightThird(prevMaghrib, fajr, "last"),
    nightThird(maghrib, nextFajr, "last"),
  ];
  for (const c of candidates) {
    if (isValidDate(c) && dateKey(c, tz) === dayKey) return c;
  }
  return null;
}

/**
 * A subscriber's schedulable anchors for the civil day containing `now` in THEIR
 * tz: the five fard plus duha (window start), qiyam (last-third start that lands
 * this civil day) and the morning/evening adhkar anchors (fajr / asr). Three
 * day-sets are computed (yesterday/today/tomorrow, DST-safe from solar noon) so
 * qiyam can be resolved to the correct side of midnight — the same pattern as
 * payload.ts. Invalid (high-latitude NaN) anchors are simply omitted; the tick
 * filters them out anyway.
 */
export function computeDefaultTable(sub: Subscription, now: Date): PrayerTimeMap {
  const base = {
    lat: sub.lat,
    lon: sub.lon,
    tz: sub.tz,
    method: sub.method as MethodName,
    asr: sub.asr as AsrMadhab,
  };
  const today = computePrayerTimes({ ...base, date: now });
  const tomorrow = computePrayerTimes({ ...base, date: new Date(today.dhuhr.getTime() + DAY_MS) });
  const yesterday = computePrayerTimes({ ...base, date: new Date(today.dhuhr.getTime() - DAY_MS) });

  const table: PrayerTimeMap = {
    fajr: today.fajr,
    dhuhr: today.dhuhr,
    asr: today.asr,
    maghrib: today.maghrib,
    isha: today.isha,
    duha: duhaWindow(today.sunrise, today.dhuhr).start,
    adhkar_morning: today.fajr,
    adhkar_evening: today.asr,
  };
  const qiyam = qiyamAnchorForDay(
    yesterday.maghrib,
    today.fajr,
    today.maghrib,
    tomorrow.fajr,
    dateKey(now, sub.tz),
    sub.tz,
  );
  if (qiyam) table.qiyam = qiyam;
  return table;
}

/**
 * Restart-safe, per-tz prayer reminder scheduler. Every tick it walks all
 * subscriptions, computes (and caches) their local-day prayer table, and for
 * each of the device's ALERT RULES × prayer checks whether `now` is inside the
 * arming window; if so it claims a fire via the persistent ledger and sends a
 * localized payload. A device can own many independent rules (different prayers,
 * different timings). See docs/NOTIFICATIONS.md §4 for the full design and the
 * three multi-location fixes over home's single-table scheduler.
 */
export class PrayerScheduler {
  private readonly subsRepo: SubscriptionsRepo;
  private readonly alertRulesRepo: AlertRulesRepo;
  private readonly logRepo: PushLogRepo;
  private readonly now: () => Date;
  private readonly computeTimes: (sub: Subscription) => PrayerTimeMap;
  private readonly send: (
    subscription: unknown,
    payload: object,
    options?: PushSendOptions,
  ) => Promise<SendResult>;
  private readonly tickMs: number;
  private readonly armingWindowMin: number;

  /** Per-endpoint cache of the current local day's table (recomputed at rollover). */
  private readonly cache = new Map<string, CachedTimes>();
  /** The last local date we pruned on — prune at most once per local day. */
  private lastPruneDateKey: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Single-flight guard: a tick that scans every subscription can outrun the 30s
   * interval (slow DB, many subscribers). Overlapping ticks would double the DB
   * load and race the shared caches, so a still-running tick makes the next one
   * skip. `tickStartedAt` lets the skip log report how long the laggard has run.
   */
  private tickRunning = false;
  private tickStartedAt: number | null = null;

  /** Durable delivery rollup; absent ⇒ counters stay in memory only. */
  private readonly statsRepo: PushStatsRepo | undefined;
  /** In-memory day counters for the dashboard, reset at UTC rollover. */
  private counterDay: string | null = null;
  private sentToday = 0;
  private failedToday = 0;
  private goneRemovedToday = 0;
  private lastTickAt: Date | null = null;
  private lastTickMs: number | null = null;
  /** Buffered rollup deltas, flushed once per tick (≤1 write per 30s). */
  private pendingStats = new Map<string, PushStatDelta>();

  constructor(deps: SchedulerDeps) {
    this.subsRepo = deps.subsRepo;
    this.alertRulesRepo = deps.alertRulesRepo;
    this.logRepo = deps.logRepo;
    this.now = deps.now ?? (() => new Date());
    this.send = deps.send ?? sendPush;
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.armingWindowMin = deps.armingWindowMin ?? DEFAULT_ARMING_WINDOW_MIN;
    this.statsRepo = deps.statsRepo;
    // Bind the default clock into the default compute so callers get per-now tables.
    this.computeTimes =
      deps.computeTimes ?? ((sub: Subscription) => computeDefaultTable(sub, this.now()));
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

  /**
   * Look up (or recompute on local-midnight rollover) a subscriber's table. On
   * rollover the outgoing table is retained as `prevTable` so "after" rules that
   * cross midnight can still resolve yesterday's prayer.
   */
  private tableFor(sub: Subscription, localDateKey: string): CachedTimes {
    const cached = this.cache.get(sub.endpoint);
    if (cached && cached.dateKey === localDateKey) return cached;
    const table = this.computeTimes(sub);
    const entry: CachedTimes = cached
      ? { dateKey: localDateKey, table, prevDateKey: cached.dateKey, prevTable: cached.table }
      : { dateKey: localDateKey, table };
    this.cache.set(sub.endpoint, entry);
    return entry;
  }

  /**
   * One scheduling pass. Public so tests can drive it directly with an injected
   * clock — no real timer needed. Errors per-subscription are isolated so one
   * bad subscriber can't stall the rest of the tick.
   */
  async tick(): Promise<void> {
    if (this.tickRunning) {
      const runningForMs = this.tickStartedAt !== null ? Date.now() - this.tickStartedAt : 0;
      log.warn("Previous tick still running; skipping this one", { runningForMs });
      return;
    }
    this.tickRunning = true;
    this.tickStartedAt = Date.now();
    try {
      const now = this.now();
      let subs: Subscription[];
      let rules: AlertRule[];
      try {
        [subs, rules] = await Promise.all([this.subsRepo.listAll(), this.alertRulesRepo.listAll()]);
      } catch (error: unknown) {
        log.error("Tick: failed to load subscriptions/rules", error instanceof Error ? error : { error });
        return;
      }

      // Group rules by device so each subscription's table is computed once.
      const rulesByEndpoint = new Map<string, AlertRule[]>();
      for (const rule of rules) {
        const arr = rulesByEndpoint.get(rule.endpoint);
        if (arr) arr.push(rule);
        else rulesByEndpoint.set(rule.endpoint, [rule]);
      }

      for (const sub of subs) {
        const subRules = rulesByEndpoint.get(sub.endpoint);
        if (!subRules || subRules.length === 0) continue; // no reminders configured
        try {
          await this.processSubscription(sub, subRules, now);
        } catch (error: unknown) {
          log.error("Tick: subscription failed", { endpoint: redactEndpoint(sub.endpoint) });
          log.error("Tick error detail", error instanceof Error ? error : { error });
        }
      }

      await this.maybePrune(now);
      this.pruneCache(subs);
      await this.flushStats();
      this.lastTickAt = now;
      this.lastTickMs = Date.now() - now.getTime();
    } finally {
      this.tickRunning = false;
      this.tickStartedAt = null;
    }
  }

  /**
   * Drop cached tables for endpoints no longer in the subscription list. The
   * cache is keyed by endpoint and would otherwise grow forever as subscribers
   * churn (a deleted/expired subscription's entry was never reclaimed). Runs
   * once per tick against the freshly loaded list. Deleting during a Map
   * key-iteration is safe in JS.
   */
  private pruneCache(subs: Subscription[]): void {
    if (this.cache.size === 0) return;
    const live = new Set(subs.map((s) => s.endpoint));
    for (const endpoint of this.cache.keys()) {
      if (!live.has(endpoint)) this.cache.delete(endpoint);
    }
  }

  /** Live table-cache entry count — introspection for tests (mirrors memSize). */
  cacheSize(): number {
    return this.cache.size;
  }

  private async processSubscription(sub: Subscription, rules: AlertRule[], now: Date): Promise<void> {
    const localDateKey = dateKey(now, sub.tz);
    const cached = this.tableFor(sub, localDateKey);
    const nowMs = now.getTime();

    for (const rule of rules) {
      const lead = leadFor(rule);
      // "after" rules may reference a prayer from the previous civil day once its
      // (prayer + offset) instant has crossed local midnight; every other timing
      // only ever fires against today's table. The arming window keeps a stale
      // ~24h-away entry in the other table from ever matching, and the fireKey
      // carries the table's own dateKey so per-day dedup stays correct.
      const days: Array<{ key: string; table: PrayerTimeMap }> = [
        { key: cached.dateKey, table: cached.table },
      ];
      if (rule.timing === "after" && cached.prevTable && cached.prevDateKey) {
        days.push({ key: cached.prevDateKey, table: cached.prevTable });
      }

      for (const { key, table } of days) {
        for (const prayer of rule.prayers) {
          if (!SCHEDULABLE_SET.has(prayer)) continue;
          const t = table[prayer];
          if (!t || !isValidDate(t)) continue; // skip invalid / NaN times

          const minutesLeft = (t.getTime() - nowMs) / MIN_MS;
          // Arming window: fire once we're within `lead` minutes, but not before
          // (lead - armingWindow). Window > tick so no fire slips between ticks.
          if (minutesLeft <= lead && minutesLeft > lead - this.armingWindowMin) {
            // Per-rule, per-day fireKey so two rules covering the same prayer
            // (and the same prayer on adjacent days) stay distinct.
            const fireKey = `${key}-r${rule.id}-${prayer}`;
            const won = await this.logRepo.tryClaim(sub.endpoint, fireKey);
            if (!won) continue; // already fired (this day) — restart/overlap safe
            await this.fire(sub, prayer, lead, t, rule.kind);
          }
        }
      }
    }
  }

  private async fire(
    sub: Subscription,
    prayer: string,
    lead: number,
    at: Date,
    kind: AlertKind,
  ): Promise<void> {
    // Defence in depth (SSRF): never POST to an endpoint that isn't a known
    // browser push service, even for a row stored before the subscribe-time
    // allowlist existed. Treat it exactly like a dead (404/410) subscription so
    // the bad row is purged and never revisited.
    if (!isAllowedPushEndpoint(sub.endpoint)) {
      await this.purgeUnsendable(sub, kind, "disallowed endpoint");
      return;
    }
    // The endpoint column is only a label: web-push actually dials the JSONB
    // `subscription` value, and a hand-crafted row can keep an allowed column
    // while pointing that JSONB endpoint at an internal address. Validate the
    // JSONB itself (same allowlist-enforcing schema as subscribe) and require its
    // endpoint to match the already-checked column; purge on either failure.
    const validSub = PushSubscriptionSchema.safeParse(sub.subscription);
    if (!validSub.success || validSub.data.endpoint !== sub.endpoint) {
      await this.purgeUnsendable(sub, kind, "subscription/endpoint mismatch");
      return;
    }
    const friday = isFridayInTz(at, sub.tz);
    // The kind rides on the payload so the service worker can branch (full-screen
    // alarm vs quiet notification). notification-text stays a pure text module.
    const payload = { ...buildPushPayload(prayer, lead, sub.lang, { friday }), kind };
    // Alarms ask the push service to wake dozing devices and to drop a stale
    // delivery (>10 min) so a siren never fires at the wrong time.
    const options: PushSendOptions | undefined =
      kind === "alarm" ? { urgency: "high", TTL: 600 } : undefined;
    const result = await this.send(sub.subscription, payload, options);
    if (result.gone) {
      // 404/410 → subscription is dead; delete it (cascades to its ledger rows).
      await this.subsRepo.deleteByEndpoint(sub.endpoint);
      this.cache.delete(sub.endpoint);
      this.count(kind, "gone");
      log.info("Removed gone subscription", { endpoint: redactEndpoint(sub.endpoint) });
      return;
    }
    this.count(kind, result.ok === false ? "failed" : "sent");
  }

  /**
   * Remove a subscription that must never be sent to (a disallowed or malformed
   * endpoint), counted as "gone" like a dead 404/410 row, and dropped from the
   * table cache so it is not revisited.
   */
  private async purgeUnsendable(sub: Subscription, kind: AlertKind, reason: string): Promise<void> {
    await this.subsRepo.deleteByEndpoint(sub.endpoint);
    this.cache.delete(sub.endpoint);
    this.count(kind, "gone");
    log.warn("Removed unsendable subscription", {
      endpoint: redactEndpoint(sub.endpoint),
      reason,
    });
  }

  /** Bump both the in-memory day counter and the buffered durable rollup. */
  private count(kind: string, outcome: PushOutcome): void {
    const day = dateKey(this.now(), "UTC");
    if (this.counterDay !== day) {
      this.counterDay = day;
      this.sentToday = 0;
      this.failedToday = 0;
      this.goneRemovedToday = 0;
    }
    if (outcome === "sent") this.sentToday += 1;
    else if (outcome === "failed") this.failedToday += 1;
    else this.goneRemovedToday += 1;

    const key = `${day}|${kind}|${outcome}`;
    const existing = this.pendingStats.get(key);
    if (existing) existing.n += 1;
    else this.pendingStats.set(key, { day, kind, outcome, n: 1 });
  }

  /** Flush buffered counters. One write per tick at most, never blocking a send. */
  private async flushStats(): Promise<void> {
    if (!this.statsRepo || this.pendingStats.size === 0) return;
    const batch = [...this.pendingStats.values()];
    this.pendingStats.clear();
    await this.statsRepo.add(batch);
  }

  /** Delivery health for the admin dashboard. */
  stats(): SchedulerSnapshot {
    // Report zeros rather than yesterday's numbers if the day rolled over
    // without any sends since.
    const today = dateKey(this.now(), "UTC");
    const fresh = this.counterDay === today;
    return {
      running: this.timer !== null,
      lastTickAt: this.lastTickAt ? this.lastTickAt.toISOString() : null,
      lastTickMs: this.lastTickMs,
      sentToday: fresh ? this.sentToday : 0,
      failedToday: fresh ? this.failedToday : 0,
      goneRemovedToday: fresh ? this.goneRemovedToday : 0,
    };
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
