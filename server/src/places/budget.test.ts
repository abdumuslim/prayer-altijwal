import { describe, it, expect } from "vitest";
import {
  admit,
  daysLeftInBillingMonth,
  MAX_PER_CLIENT,
  MIN_PER_CLIENT,
  planBudget,
  ptDayKey,
  ptMonthKey,
} from "./budget.js";

describe("Pacific billing calendar", () => {
  // Google's free tier resets at midnight PACIFIC on the 1st, so every counter
  // and every "days left" figure has to be measured in that zone — not UTC (the
  // VPS clock) and not the user's zone.
  it("uses the Pacific date, not UTC", () => {
    // 2026-07-01T05:00Z is still 22:00 on 2026-06-30 in Los Angeles.
    const d = new Date("2026-07-01T05:00:00Z");
    expect(ptDayKey(d)).toBe("2026-06-30");
    expect(ptMonthKey(d)).toBe("2026-06");
  });

  it("rolls over to the new month once Pacific midnight passes", () => {
    const d = new Date("2026-07-01T08:00:00Z"); // 01:00 on the 1st in LA
    expect(ptDayKey(d)).toBe("2026-07-01");
    expect(ptMonthKey(d)).toBe("2026-07");
  });

  it("counts the days left in the Pacific month inclusively", () => {
    expect(daysLeftInBillingMonth(new Date("2026-07-01T08:00:00Z"))).toBe(31);
    expect(daysLeftInBillingMonth(new Date("2026-07-25T18:00:00Z"))).toBe(7);
    expect(daysLeftInBillingMonth(new Date("2026-07-31T18:00:00Z"))).toBe(1);
  });

  it("handles February and a leap year", () => {
    expect(daysLeftInBillingMonth(new Date("2026-02-01T08:00:00Z"))).toBe(28);
    expect(daysLeftInBillingMonth(new Date("2028-02-01T08:00:00Z"))).toBe(29);
  });
});

describe("planBudget", () => {
  it("paces the remaining month evenly across the days left", () => {
    const plan = planBudget({ monthlyCap: 4500, usedThisMonth: 0, daysLeft: 30, activeClients: 50 });
    expect(plan.dailyPool).toBe(150);
  });

  it("WIDENS tomorrow's pool after a quiet day — the self-correcting property", () => {
    const quiet = planBudget({
      monthlyCap: 3000,
      usedThisMonth: 0,
      daysLeft: 10,
      activeClients: 10,
    });
    const afterSpending = planBudget({
      monthlyCap: 3000,
      usedThisMonth: 100, // spent far less than the 300 available
      daysLeft: 9,
      activeClients: 10,
    });
    expect(quiet.dailyPool).toBe(300);
    expect(afterSpending.dailyPool).toBeGreaterThan(300);
  });

  it("NARROWS the pool after a heavy day", () => {
    const plan = planBudget({
      monthlyCap: 3000,
      usedThisMonth: 2000,
      daysLeft: 9,
      activeClients: 10,
    });
    expect(plan.dailyPool).toBeLessThan(300);
  });

  it("holds a reserve back for first-time clients", () => {
    const plan = planBudget({ monthlyCap: 3000, usedThisMonth: 0, daysLeft: 10, activeClients: 10 });
    expect(plan.reserve).toBe(60); // 20% of 300
    expect(plan.reserve).toBeLessThan(plan.dailyPool);
  });

  it("divides the non-reserved pool across the observed active clients", () => {
    const plan = planBudget({ monthlyCap: 3000, usedThisMonth: 0, daysLeft: 10, activeClients: 48 });
    // (300 - 60) / 48 = 5
    expect(plan.perClientCap).toBe(5);
  });

  it("clamps the per-client cap so it is neither useless nor unlimited", () => {
    const tiny = planBudget({ monthlyCap: 60, usedThisMonth: 0, daysLeft: 30, activeClients: 500 });
    expect(tiny.perClientCap).toBe(MIN_PER_CLIENT);

    const huge = planBudget({ monthlyCap: 100_000, usedThisMonth: 0, daysLeft: 1, activeClients: 1 });
    expect(huge.perClientCap).toBe(MAX_PER_CLIENT);
  });

  it("lets an IP cover a household or a NAT without becoming a sweeper's loophole", () => {
    const plan = planBudget({ monthlyCap: 3000, usedThisMonth: 0, daysLeft: 10, activeClients: 48 });
    expect(plan.perIpCap).toBe(plan.perClientCap * 3);
  });

  it("still allows a trickle when the month is nearly spent", () => {
    const plan = planBudget({ monthlyCap: 100, usedThisMonth: 95, daysLeft: 20, activeClients: 10 });
    expect(plan.dailyPool).toBe(1); // 5/20 floors to 0 — don't strand the rest
    expect(plan.perClientCap).toBeGreaterThanOrEqual(1);
  });

  it("shuts spending down completely once the cap is reached", () => {
    const plan = planBudget({ monthlyCap: 100, usedThisMonth: 100, daysLeft: 5, activeClients: 10 });
    expect(plan.dailyPool).toBe(0);
    expect(plan.perClientCap).toBe(0);
    expect(plan.perIpCap).toBe(0);
  });

  it("never divides by zero on a fresh install with no observed clients", () => {
    const plan = planBudget({ monthlyCap: 3000, usedThisMonth: 0, daysLeft: 10, activeClients: 0 });
    expect(Number.isFinite(plan.perClientCap)).toBe(true);
    expect(plan.perClientCap).toBe(MAX_PER_CLIENT);
  });

  it("tolerates a nonsense over-spend without producing a negative pool", () => {
    const plan = planBudget({
      monthlyCap: 100,
      usedThisMonth: 500,
      daysLeft: 5,
      activeClients: 10,
    });
    expect(plan.dailyPool).toBe(0);
  });
});

describe("admit", () => {
  const plan = planBudget({ monthlyCap: 3000, usedThisMonth: 0, daysLeft: 10, activeClients: 48 });
  // dailyPool 300, reserve 60, perClientCap 5, perIpCap 15

  const base = { plan, globalToday: 0, clientToday: 0, ipToday: 0, isNewClient: false };

  it("allows an ordinary first lookup of the day", () => {
    expect(admit({ ...base }, 1)).toBe("allow");
  });

  it("stops a client at its per-client cap", () => {
    expect(admit({ ...base, clientToday: 4 }, 1)).toBe("allow");
    expect(admit({ ...base, clientToday: 5 }, 1)).toBe("deny_client");
  });

  it("stops an IP at its (higher) cap even across different client ids", () => {
    expect(admit({ ...base, ipToday: 15 }, 1)).toBe("deny_ip");
  });

  it("keeps the reserve out of reach of a returning client", () => {
    // 240 = pool(300) - reserve(60)
    expect(admit({ ...base, globalToday: 239 }, 1)).toBe("allow");
    expect(admit({ ...base, globalToday: 240 }, 1)).toBe("deny_global");
  });

  it("lets a FIRST-TIME client draw on the reserve — a newcomer never sees a degraded app", () => {
    expect(admit({ ...base, globalToday: 240, isNewClient: true }, 1)).toBe("allow");
    expect(admit({ ...base, globalToday: 300, isNewClient: true }, 1)).toBe("deny_global");
  });

  it("charges multi-unit spends correctly (a travel lookup costs 2)", () => {
    expect(admit({ ...base, clientToday: 3 }, 2)).toBe("allow");
    expect(admit({ ...base, clientToday: 4 }, 2)).toBe("deny_client");
  });

  it("denies everything once the plan is exhausted", () => {
    const dead = planBudget({ monthlyCap: 10, usedThisMonth: 10, daysLeft: 5, activeClients: 5 });
    expect(admit({ plan: dead, globalToday: 0, clientToday: 0, ipToday: 0, isNewClient: true }, 1)).toBe(
      "deny_global",
    );
  });
});
