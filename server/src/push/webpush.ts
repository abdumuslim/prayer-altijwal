import webpush, { type PushSubscription, type WebPushError } from "web-push";
import { childLogger } from "../logger.js";

const log = childLogger("push/webpush");

export interface VapidDetails {
  publicKey: string;
  privateKey: string;
  /** Contact URI, e.g. "mailto:admin@altijwal.com". */
  subject: string;
}

/** Result of a single send attempt. `gone` means the subscription is dead (404/410). */
export interface SendResult {
  ok: boolean;
  gone: boolean;
}

/**
 * Per-send delivery options. Alarms send `{ urgency: "high", TTL: 600 }` so the
 * push service wakes dozing devices promptly and drops an alarm that would land
 * >10 min late (avoiding a siren at the wrong time). Notifications use defaults.
 */
export interface PushSendOptions {
  TTL?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
}

/** Configure VAPID details once at boot. */
export function setupWebPush(vapid: VapidDetails): void {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  log.info("Web-push configured", { subject: vapid.subject });
}

function isWebPushError(error: unknown): error is WebPushError {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  );
}

/**
 * Send a push payload. The push service returns 404/410 when a subscription is
 * no longer valid → `gone:true` so the caller can delete it. Any other failure
 * is logged and reported as `ok:false` (transient — keep the subscription).
 */
export async function sendPush(
  subscription: unknown,
  payload: object,
  options?: PushSendOptions,
): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      subscription as PushSubscription,
      JSON.stringify(payload),
      options,
    );
    return { ok: true, gone: false };
  } catch (error: unknown) {
    if (isWebPushError(error)) {
      const { statusCode } = error;
      if (statusCode === 404 || statusCode === 410) {
        log.info("Subscription gone — will be removed", { statusCode });
        return { ok: false, gone: true };
      }
      log.error("Push send failed", { statusCode, body: error.body });
      return { ok: false, gone: false };
    }
    log.error("Push send failed", error instanceof Error ? error : { error });
    return { ok: false, gone: false };
  }
}
