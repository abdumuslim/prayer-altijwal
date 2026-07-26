import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { childLogger } from "../../logger.js";
import type { AdminAuditRepo } from "../../db/repositories/admin-audit.js";
import type { AppSettingsRepo } from "../../db/repositories/app-settings.js";
import { actorIpOf, requireSession, type SessionConfig } from "../middleware.js";

const log = childLogger("admin/settings");

/**
 * Keys are namespaced and enumerated here — the PUT body is validated against
 * this list, so the endpoint can never be used to write arbitrary rows.
 */
export const SETTING_KEYS = {
  placesEnabled: "places.enabled",
  placesTravelEnabled: "places.travelEnabled",
  placesMonthlyUnitCap: "places.monthlyUnitCap",
  telemetryEnabled: "telemetry.enabled",
} as const;

export interface SettingsDefaults {
  placesEnabled: boolean;
  placesTravelEnabled: boolean;
  placesMonthlyUnitCap: number;
  telemetryEnabled: boolean;
}

export interface SettingsAdminDeps {
  readonly settings?: AppSettingsRepo;
  /** Env-derived values — the floor every read falls back to. */
  readonly settingsDefaults: SettingsDefaults;
  /** Applied immediately so a cap change doesn't wait for a restart. */
  readonly applyMonthlyCap?: (cap: number) => void;
  readonly audit?: AdminAuditRepo;
}

const PutBody = z
  .object({
    placesEnabled: z.boolean().optional(),
    placesTravelEnabled: z.boolean().optional(),
    // 0 disables paid upstream work entirely; the ceiling is a sanity bound,
    // not a licence — the GCP-side quota remains the real billing backstop.
    placesMonthlyUnitCap: z.number().int().min(0).max(100_000).optional(),
    telemetryEnabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No settings to update" });

export function createSettingsRoutes(cfg: SessionConfig, deps: SettingsAdminDeps): Router {
  const r = Router();
  const guard = requireSession(cfg);

  async function currentValues(): Promise<{
    values: SettingsDefaults;
    sources: Record<string, "db" | "env">;
  }> {
    const d = deps.settingsDefaults;
    if (!deps.settings) {
      return {
        values: d,
        sources: Object.fromEntries(
          Object.keys(SETTING_KEYS).map((k) => [k, "env" as const]),
        ) as Record<string, "env">,
      };
    }
    const stored = await deps.settings.all();
    const sourceOf = (key: string): "db" | "env" =>
      stored[key] === undefined || stored[key] === null ? "env" : "db";

    return {
      values: {
        placesEnabled: await deps.settings.get(SETTING_KEYS.placesEnabled, d.placesEnabled),
        placesTravelEnabled: await deps.settings.get(
          SETTING_KEYS.placesTravelEnabled,
          d.placesTravelEnabled,
        ),
        placesMonthlyUnitCap: await deps.settings.get(
          SETTING_KEYS.placesMonthlyUnitCap,
          d.placesMonthlyUnitCap,
        ),
        telemetryEnabled: await deps.settings.get(
          SETTING_KEYS.telemetryEnabled,
          d.telemetryEnabled,
        ),
      },
      sources: {
        placesEnabled: sourceOf(SETTING_KEYS.placesEnabled),
        placesTravelEnabled: sourceOf(SETTING_KEYS.placesTravelEnabled),
        placesMonthlyUnitCap: sourceOf(SETTING_KEYS.placesMonthlyUnitCap),
        telemetryEnabled: sourceOf(SETTING_KEYS.telemetryEnabled),
      },
    };
  }

  r.get("/api/admin/settings", guard, async (_req: Request, res: Response) => {
    const { values, sources } = await currentValues();
    res.json({ values, sources, defaults: deps.settingsDefaults, writable: Boolean(deps.settings) });
  });

  r.put("/api/admin/settings", guard, async (req: Request, res: Response) => {
    if (!deps.settings) {
      res.status(503).json({ error: "Database unavailable — settings are read-only" });
      return;
    }
    const parsed = PutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid body" });
      return;
    }

    const entries = Object.entries(parsed.data) as [keyof SettingsDefaults, unknown][];
    for (const [name, value] of entries) {
      await deps.settings.set(SETTING_KEYS[name], value);
    }
    if (parsed.data.placesMonthlyUnitCap !== undefined) {
      deps.applyMonthlyCap?.(parsed.data.placesMonthlyUnitCap);
    }

    log.info("settings updated", { keys: entries.map(([k]) => k) });
    void deps.audit?.append({
      action: "settings.update",
      actorIp: actorIpOf(req),
      details: parsed.data,
    });

    const { values, sources } = await currentValues();
    res.json({ ok: true, values, sources });
  });

  /** Drop an override so the env value governs again. */
  r.delete("/api/admin/settings/:name", guard, async (req: Request, res: Response) => {
    if (!deps.settings) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }
    const name = req.params.name as keyof typeof SETTING_KEYS;
    if (!(name in SETTING_KEYS)) {
      res.status(404).json({ error: "Unknown setting" });
      return;
    }
    // Storing null is treated as "no override" by every reader.
    await deps.settings.set(SETTING_KEYS[name], null);
    if (name === "placesMonthlyUnitCap") {
      deps.applyMonthlyCap?.(deps.settingsDefaults.placesMonthlyUnitCap);
    }
    void deps.audit?.append({
      action: "settings.reset",
      target: name,
      actorIp: actorIpOf(req),
    });
    const { values, sources } = await currentValues();
    res.json({ ok: true, values, sources });
  });

  return r;
}
