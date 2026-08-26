import { describe, it, expect } from "vitest";
import {
  AlertRuleBody,
  PushSubscriptionSchema,
  isAllowedPushEndpoint,
  PUSH_ENDPOINT_MAX_LEN,
} from "./push.js";

const base = {
  endpoint: "https://push.example/ep1",
  prayers: ["fajr", "dhuhr"],
};

describe("isAllowedPushEndpoint", () => {
  it("accepts the known browser push services (incl. subdomains)", () => {
    for (const url of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QABC",
      "https://push.apple.com/QABC",
      "https://xyz.notify.windows.com/w/?token=abc",
    ]) {
      expect(isAllowedPushEndpoint(url)).toBe(true);
    }
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
  });

  it("rejects internal-address / SSRF targets", () => {
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1:8000/steal")).toBe(false);
    expect(isAllowedPushEndpoint("https://localhost/internal")).toBe(false);
  });

  it("rejects look-alike / suffix-smuggling domains", () => {
    expect(isAllowedPushEndpoint("https://evil-fcm.googleapis.com.attacker.tld/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.attacker.tld/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://notfcm.googleapis.com/x")).toBe(false);
  });

  it("rejects a garbage or over-long string", () => {
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
    expect(isAllowedPushEndpoint(`https://fcm.googleapis.com/${"a".repeat(PUSH_ENDPOINT_MAX_LEN)}`)).toBe(
      false,
    );
  });
});

describe("PushSubscriptionSchema", () => {
  const keys = { p256dh: "p", auth: "a" };

  it("accepts a real FCM subscription", () => {
    const parsed = PushSubscriptionSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a subscription whose endpoint is not a known push service", () => {
    expect(
      PushSubscriptionSchema.safeParse({ endpoint: "https://evil.example/x", keys }).success,
    ).toBe(false);
    expect(
      PushSubscriptionSchema.safeParse({ endpoint: "http://fcm.googleapis.com/x", keys }).success,
    ).toBe(false);
  });
});

describe("AlertRuleBody", () => {
  it("defaults kind to 'notification' when omitted", () => {
    const parsed = AlertRuleBody.parse({ ...base, timing: "at_time" });
    expect(parsed.kind).toBe("notification");
  });

  it("accepts kind 'alarm'", () => {
    const parsed = AlertRuleBody.parse({ ...base, timing: "at_time", kind: "alarm" });
    expect(parsed.kind).toBe("alarm");
  });

  it("rejects an unknown kind", () => {
    const result = AlertRuleBody.safeParse({ ...base, timing: "at_time", kind: "siren" });
    expect(result.success).toBe(false);
  });

  it("accepts a custom minutes value inside 1–180", () => {
    const parsed = AlertRuleBody.parse({ ...base, timing: "before", minutes: 45 });
    expect(parsed.minutes).toBe(45);
  });

  it("rejects minutes below 1", () => {
    expect(AlertRuleBody.safeParse({ ...base, timing: "before", minutes: 0 }).success).toBe(false);
  });

  it("rejects minutes above 180", () => {
    expect(AlertRuleBody.safeParse({ ...base, timing: "before", minutes: 181 }).success).toBe(false);
  });

  it("requires minutes when timing is 'before'", () => {
    expect(AlertRuleBody.safeParse({ ...base, timing: "before" }).success).toBe(false);
  });

  it("requires minutes when timing is 'after'", () => {
    expect(AlertRuleBody.safeParse({ ...base, timing: "after" }).success).toBe(false);
  });

  it("allows at_time without minutes", () => {
    expect(AlertRuleBody.safeParse({ ...base, timing: "at_time" }).success).toBe(true);
  });
});
