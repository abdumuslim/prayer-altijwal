import { z } from "zod";
import { METHODS } from "../prayer-engine/index.js";

const methodKeys = Object.keys(METHODS) as [string, ...string[]];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Query schema for GET /api/prayer-times. Coerces numeric query strings. */
export const PrayerTimesQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  tz: z.string().min(1).refine(isValidTimeZone, { message: "Invalid timezone" }),
  method: z.enum(methodKeys).optional(),
  country: z.string().trim().length(2).optional(),
  city: z.string().trim().max(120).optional(),
  asr: z.enum(["Standard", "Hanafi"]).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
    .optional(),
  elevation: z.coerce.number().min(-500).max(9000).optional(),
  lang: z.enum(["ar", "en"]).default("ar"),
});

export type PrayerTimesQueryInput = z.infer<typeof PrayerTimesQuery>;
