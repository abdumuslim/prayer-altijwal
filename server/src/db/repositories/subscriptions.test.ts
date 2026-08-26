import { describe, it, expect } from "vitest";
import { redactEndpoint } from "./subscriptions.js";

describe("redactEndpoint", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/SECRET-TOKEN-abcdef";

  it("emits only the host plus a short token — never the full URL", () => {
    const out = redactEndpoint(endpoint);
    expect(out.startsWith("fcm.googleapis.com#")).toBe(true);
    expect(out).not.toContain("SECRET-TOKEN");
    expect(out).not.toContain("/fcm/send");
    // host + '#' + 8 hex chars.
    expect(out).toMatch(/^fcm\.googleapis\.com#[0-9a-f]{8}$/);
  });

  it("is deterministic and distinguishes different endpoints", () => {
    expect(redactEndpoint(endpoint)).toBe(redactEndpoint(endpoint));
    expect(redactEndpoint(endpoint)).not.toBe(
      redactEndpoint("https://fcm.googleapis.com/fcm/send/OTHER"),
    );
  });

  it("still returns a token for a malformed URL", () => {
    expect(redactEndpoint("not a url")).toMatch(/^invalid#[0-9a-f]{8}$/);
  });
});
