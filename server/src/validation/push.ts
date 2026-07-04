import { z } from "zod";

/** The browser PushSubscription shape (endpoint + the two encryption keys). */
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** Prayers stored on the legacy subscription columns (sunrise is informational only). */
const PrayerName = z.enum(["fajr", "dhuhr", "asr", "maghrib", "isha"]);
/**
 * Targets an alert rule may fire on: the five fard plus the sunnah/adhkar anchors
 * (duha = window start, qiyam = last-third start, morning/evening adhkar). Kept
 * separate from PrayerName so the legacy subscription columns stay fard-only.
 */
const AlertTarget = z.enum([
  "fajr",
  "dhuhr",
  "asr",
  "maghrib",
  "isha",
  "duha",
  "qiyam",
  "adhkar_morning",
  "adhkar_evening",
]);
const Lang = z.enum(["ar", "en"]);

/** POST /api/push/subscribe body. Reminders live in alert rules now, so prayers/
 *  leadMinutes are optional (legacy columns; kept for back-compat). */
export const SubscribeBody = z.object({
  subscription: PushSubscriptionSchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  tz: z.string().min(1).max(64),
  country: z.string().min(1).max(2).optional(),
  method: z.string().min(1).max(40).optional(),
  asr: z.enum(["Standard", "Hanafi"]).optional(),
  prayers: z.array(PrayerName).min(1).optional(),
  leadMinutes: z.array(z.number().int().min(0).max(180)).min(1).optional(),
  lang: Lang,
});

export type SubscribeInput = z.infer<typeof SubscribeBody>;

/** Body for POST /api/push/alerts and PUT /api/push/alerts/:id. */
export const AlertRuleBody = z
  .object({
    endpoint: z.string().url(),
    timing: z.enum(["at_time", "before", "after"]),
    minutes: z.number().int().min(1).max(180).nullable().optional(),
    prayers: z.array(AlertTarget).min(1),
  })
  .refine((b) => b.timing === "at_time" || (b.minutes != null && b.minutes >= 1), {
    message: "minutes (1–180) is required when timing is 'before' or 'after'",
    path: ["minutes"],
  });

export type AlertRuleInput = z.infer<typeof AlertRuleBody>;

/** Query for DELETE /api/push/alerts/:id (ownership scoped to the endpoint). */
export const AlertDeleteQuery = z.object({
  endpoint: z.string().url(),
});

/** POST /api/push/unsubscribe body. */
export const UnsubscribeBody = z.object({
  endpoint: z.string().url(),
});

export type UnsubscribeInput = z.infer<typeof UnsubscribeBody>;

/** POST /api/push/prefs body — endpoint plus any subset of mutable prefs. */
export const PrefsBody = z.object({
  endpoint: z.string().url(),
  prayers: z.array(PrayerName).min(1).optional(),
  leadMinutes: z.array(z.number().int().min(0).max(180)).min(1).optional(),
  method: z.string().min(1).max(40).optional(),
  asr: z.enum(["Standard", "Hanafi"]).optional(),
  lang: Lang.optional(),
});

export type PrefsInput = z.infer<typeof PrefsBody>;
