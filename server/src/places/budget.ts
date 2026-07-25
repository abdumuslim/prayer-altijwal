/**
 * Persistent spend governor for the paid Places/Routes calls (ADR-014).
 *
 * ADR-011 added a rolling-minute breaker, which bounds a BURST but not a MONTH:
 * 30 units/minute sustained is ~43 000 a day, so an attacker — or an unlucky
 * traffic spike — could still drain a month's free tier in an afternoon. This
 * module is the volume half: it paces what remains of the monthly allowance
 * across the days left, then divides a day's share among the clients actually
 * using the app.
 *
 * Pure functions only: every input (clock, counters, observed client count) is
 * passed in, so the pacing rules are testable without a database or a calendar.
 */

/** Google's free tier resets at midnight PACIFIC on the 1st of the month. */
export const BILLING_TZ = "America/Los_Angeles";

/** Share of a day's pool held back for clients that have never spent before. */
export const RESERVE_FRACTION = 0.2;

/**
 * A normal user generates 0–2 budget-consuming lookups a day (a cache or
 * resident hit costs nothing and is never counted), so these bounds are
 * invisible in ordinary use and decisive against a coordinate sweep.
 */
export const MIN_PER_CLIENT = 2;
export const MAX_PER_CLIENT = 10;

/** An IP may be a household or a mobile NAT, so it gets a multiple of a client. */
export const IP_MULTIPLIER = 3;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BILLING_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day in Google's billing zone, as `YYYY-MM-DD`. */
export function ptDayKey(now: Date = new Date()): string {
  return dayFormatter.format(now);
}

/** Calendar month in Google's billing zone, as `YYYY-MM`. */
export function ptMonthKey(now: Date = new Date()): string {
  return ptDayKey(now).slice(0, 7);
}

/** Days remaining in the Pacific billing month, counting today. */
export function daysLeftInBillingMonth(now: Date = new Date()): number {
  const [year, month, day] = ptDayKey(now).split("-").map(Number) as [number, number, number];
  // Day 0 of the NEXT month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return daysInMonth - day + 1;
}

export interface BudgetInputs {
  /** Monthly ceiling we hold ourselves to (below Google's, for headroom). */
  monthlyCap: number;
  usedThisMonth: number;
  daysLeft: number;
  /** Distinct clients that have spent recently — the real denominator. */
  activeClients: number;
}

export interface BudgetPlan {
  dailyPool: number;
  reserve: number;
  perClientCap: number;
  perIpCap: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Today's spending plan.
 *
 * The pool is self-correcting by construction: it is always
 * `remaining / daysLeft`, so a quiet day leaves more for tomorrow and a heavy
 * one leaves less, with no manual tuning and no way to overrun the month.
 */
export function planBudget(inputs: BudgetInputs): BudgetPlan {
  const remaining = Math.max(0, inputs.monthlyCap - inputs.usedThisMonth);
  const daysLeft = Math.max(1, inputs.daysLeft);

  if (remaining <= 0) return { dailyPool: 0, reserve: 0, perClientCap: 0, perIpCap: 0 };

  // A near-exhausted month floors to zero per day, which would strand the last
  // few calls unspent — let a trickle through instead.
  const dailyPool = Math.max(1, Math.floor(remaining / daysLeft));
  const reserve = Math.ceil(RESERVE_FRACTION * dailyPool);
  const shared = Math.max(0, dailyPool - reserve);
  const perClientCap = clamp(
    Math.round(shared / Math.max(1, inputs.activeClients)),
    MIN_PER_CLIENT,
    MAX_PER_CLIENT,
  );

  return { dailyPool, reserve, perClientCap, perIpCap: perClientCap * IP_MULTIPLIER };
}

export interface AdmissionInputs {
  plan: BudgetPlan;
  globalToday: number;
  clientToday: number;
  ipToday: number;
  /** No recorded spend ever — gets access to the reserve. */
  isNewClient: boolean;
}

export type AdmissionVerdict = "allow" | "deny_global" | "deny_client" | "deny_ip";

/**
 * May this request spend `units`?
 *
 * A denial is not an error: the caller falls back to the best free answer it
 * has. The reserve is the one asymmetry — a first-time user gets to reach past
 * the day's shared pool, so discovering the app never lands you on a degraded
 * version of it.
 */
export function admit(i: AdmissionInputs, units: number): AdmissionVerdict {
  if (i.plan.dailyPool <= 0) return "deny_global";

  const ceiling = i.isNewClient ? i.plan.dailyPool : i.plan.dailyPool - i.plan.reserve;
  if (i.globalToday + units > ceiling) return "deny_global";
  if (i.clientToday + units > i.plan.perClientCap) return "deny_client";
  if (i.ipToday + units > i.plan.perIpCap) return "deny_ip";
  return "allow";
}
