import { z } from "zod";

/** The browser PushSubscription shape (endpoint + the two encryption keys). */
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/** Prayers that may be selected for reminders (sunrise is informational only). */
const PrayerName = z.enum(["fajr", "dhuhr", "asr", "maghrib", "isha"]);
const Lang = z.enum(["ar", "en"]);

/** POST /api/push/subscribe body. */
export const SubscribeBody = z.object({
  subscription: PushSubscriptionSchema,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  tz: z.string().min(1).max(64),
  country: z.string().min(1).max(2).optional(),
  method: z.string().min(1).max(40).optional(),
  asr: z.enum(["Standard", "Hanafi"]).optional(),
  prayers: z.array(PrayerName).min(1),
  leadMinutes: z.array(z.number().int().min(0).max(180)).min(1),
  lang: Lang,
});

export type SubscribeInput = z.infer<typeof SubscribeBody>;

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
