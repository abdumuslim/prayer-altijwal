import { z } from "zod";

/** A subscription endpoint is a URL we later POST to from the server, so bound
 *  its length: a real browser push endpoint is well under 2 KB. */
export const PUSH_ENDPOINT_MAX_LEN = 2048;

/**
 * The browser push services we are willing to store — and later send to — an
 * endpoint for. The scheduler POSTs to whatever endpoint is on the row, so an
 * unrestricted `z.string().url()` is an SSRF / outbound-request proxy: a crafted
 * subscribe could point the server at an internal address. An endpoint host must
 * be one of these or a dot-boundary subdomain of one.
 */
const PUSH_ENDPOINT_HOSTS = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "push.apple.com",
  "notify.windows.com",
] as const;

/**
 * True when `endpoint` is an https URL on a known browser push service. Pure and
 * exported so both the subscribe boundary and the send path (defence in depth,
 * purging pre-existing bad rows) apply the exact same rule. The dot-boundary
 * check rejects look-alikes like `evil-fcm.googleapis.com.attacker.tld`.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== "string" || endpoint.length > PUSH_ENDPOINT_MAX_LEN) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_ENDPOINT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** The browser PushSubscription shape (endpoint + the two encryption keys). */
export const PushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(PUSH_ENDPOINT_MAX_LEN)
    .url()
    .refine(isAllowedPushEndpoint, { message: "Unsupported push endpoint" }),
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
    // How the reminder presents. Defaults so pre-alarm clients keep working.
    kind: z.enum(["notification", "alarm"]).default("notification"),
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
