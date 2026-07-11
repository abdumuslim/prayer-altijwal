import { describe, it, expect } from "vitest";
import { AlertRuleBody } from "./push.js";

const base = {
  endpoint: "https://push.example/ep1",
  prayers: ["fajr", "dhuhr"],
};

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
