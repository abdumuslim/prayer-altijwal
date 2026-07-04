import { childLogger } from "../logger.js";
import { dateKey, isValidDate } from "../prayer/format.js";
import { computePrayerTimes } from "../prayer/compute.js";
import { duhaWindow, nightThird } from "../prayer-engine/sunnah.js";
import type { SubscriptionsRepo, Subscription } from "../db/repositories/subscriptions.js";
import type { AlertRule, AlertRulesRepo } from "../db/repositories/alert-rules.js";
import type { PushLogRepo } from "../db/repositories/push-log.js";
import { sendPush, type SendResult } from "./webpush.js";
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
  send?: (subscription: unknown, payload: object) => Promise<SendResult>;
  /** Tick interval in ms. Default 30000. */
  tickMs?: number;
  /**
   * Arming window in minutes — must exceed the tick interval so no fire is
   * skipped between ticks. The DB dedup absorbs the resulting duplicate hits.
   */
  armingWindowMin?: number;
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
    this.alertRulesRepo = deps.alertRulesRepo;
    this.logRepo = deps.logRepo;
    this.now = deps.now ?? (() => new Date());
    this.send = deps.send ?? sendPush;
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.armingWindowMin = deps.armingWindowMin ?? DEFAULT_ARMING_WINDOW_MIN;
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
        log.error("Tick: subscription failed", { endpoint: sub.endpoint });
        log.error("Tick error detail", error instanceof Error ? error : { error });
      }
    }

    await this.maybePrune(now);
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
            await this.fire(sub, prayer, lead, t);
          }
        }
      }
    }
  }

  private async fire(sub: Subscription, prayer: string, lead: number, at: Date): Promise<void> {
    const friday = isFridayInTz(at, sub.tz);
    const payload = buildPushPayload(prayer, lead, sub.lang, { friday });
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
