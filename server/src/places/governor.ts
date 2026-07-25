import { childLogger } from "../logger.js";
import {
  admit,
  daysLeftInBillingMonth,
  planBudget,
  ptDayKey,
  ptMonthKey,
  type AdmissionVerdict,
  type BudgetPlan,
} from "./budget.js";
import type { PlacesUsageRepo } from "../db/repositories/places-usage.js";

const log = childLogger("places/governor");

/** Why a spend was refused — mirrors the telemetry outcome names. */
export type DenyReason = "denied_budget" | "denied_client" | "denied_ip";

export interface Spender {
  /** Pacific billing day this request belongs to. */
  day: string;
  /** Hour of that day, for the load-shape rollup. */
  hour: number;
  /** Reserve `units` of paid upstream work. False ⇒ the caller degrades. */
  spend(units: number): Promise<boolean>;
  /** Set once a spend has been refused, for the telemetry outcome. */
  deniedReason(): DenyReason | undefined;
  /** Units actually committed on this request. */
  spent(): number;
}

export interface GovernorCaps {
  /** Our self-imposed monthly ceiling, below Google's free tier for headroom. */
  monthlyCap: number;
}

export interface PlacesGovernor {
  open(clientId: string, ipKey: string, now?: Date): Promise<Spender>;
  plan(now?: Date): Promise<BudgetPlan & { usedThisMonth: number; activeClients: number }>;
}

const verdictToReason: Record<Exclude<AdmissionVerdict, "allow">, DenyReason> = {
  deny_global: "denied_budget",
  deny_client: "denied_client",
  deny_ip: "denied_ip",
};

function hourOf(now: Date): number {
  // The rollup only needs a coarse load shape, so the server's own hour is fine
  // — unlike the DAY, which must be Pacific to line up with Google's reset.
  return now.getUTCHours();
}

/**
 * Spend governor (ADR-014): pairs the pure pacing math in budget.ts with the
 * persistent counters in places_usage.
 *
 * Every request opens a spender, which records the request itself; only the
 * requests that actually reach Google consume budget. Denials are ordinary — the
 * caller falls back to a free answer — so nothing here throws.
 */
export function createPlacesGovernor(
  usage: PlacesUsageRepo,
  caps: GovernorCaps,
): PlacesGovernor {
  async function currentPlan(now: Date) {
    const day = ptDayKey(now);
    const month = ptMonthKey(now);
    const snap = await usage.snapshot(day, month, "", "");
    return {
      ...planBudget({
        monthlyCap: caps.monthlyCap,
        usedThisMonth: snap.usedThisMonth,
        daysLeft: daysLeftInBillingMonth(now),
        activeClients: snap.activeClients,
      }),
      usedThisMonth: snap.usedThisMonth,
      activeClients: snap.activeClients,
    };
  }

  return {
    plan: (now = new Date()) => currentPlan(now),

    async open(clientId, ipKey, now = new Date()) {
      const day = ptDayKey(now);
      const month = ptMonthKey(now);
      const hour = hourOf(now);

      // Recorded for EVERY request, cached or not — this is what makes the
      // active-client count real rather than a guess.
      await usage.noteRequest(day, clientId, ipKey);

      let denied: DenyReason | undefined;
      let committed = 0;

      return {
        day,
        hour,
        deniedReason: () => denied,
        spent: () => committed,

        async spend(units) {
          const snap = await usage.snapshot(day, month, clientId, ipKey);
          const budget = planBudget({
            monthlyCap: caps.monthlyCap,
            usedThisMonth: snap.usedThisMonth,
            daysLeft: daysLeftInBillingMonth(now),
            activeClients: snap.activeClients,
          });

          const verdict = admit(
            {
              plan: budget,
              globalToday: snap.globalToday,
              clientToday: snap.clientToday,
              ipToday: snap.ipToday,
              isNewClient: snap.isNewClient,
            },
            units,
          );

          if (verdict !== "allow") {
            denied = verdictToReason[verdict];
            log.debug("spend refused", { reason: denied, units });
            return false;
          }

          // Re-checked atomically at the row: two concurrent requests from one
          // client cannot both pass the cap they just both read as clear.
          const ok = await usage.commitSpend(day, clientId, ipKey, units, budget.perClientCap);
          if (!ok) {
            denied = "denied_client";
            return false;
          }
          committed += units;
          return true;
        },
      };
    },
  };
}
