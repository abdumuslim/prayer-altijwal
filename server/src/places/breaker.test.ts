import { describe, it, expect } from "vitest";
import { RollingBudget } from "./breaker.js";

describe("RollingBudget", () => {
  it("allows calls up to the cap and refuses the one that would exceed it", () => {
    const b = new RollingBudget(3);
    expect(b.tryConsume(1, 1000)).toBe(true);
    expect(b.tryConsume(1, 1000)).toBe(true);
    expect(b.tryConsume(1, 1000)).toBe(true);
    expect(b.tryConsume(1, 1000)).toBe(false);
  });

  it("does not spend the budget on a refused call", () => {
    const b = new RollingBudget(3);
    expect(b.tryConsume(2, 0)).toBe(true);
    expect(b.tryConsume(2, 0)).toBe(false); // would be 4 > 3
    expect(b.remaining(0)).toBe(1); // still 1 left, the refusal cost nothing
    expect(b.tryConsume(1, 0)).toBe(true);
  });

  it("charges multi-unit calls correctly (a travel lookup costs 2)", () => {
    const b = new RollingBudget(5);
    expect(b.tryConsume(2, 0)).toBe(true);
    expect(b.tryConsume(2, 0)).toBe(true);
    expect(b.remaining(0)).toBe(1);
    expect(b.tryConsume(2, 0)).toBe(false);
  });

  it("resets once the window elapses", () => {
    const b = new RollingBudget(2);
    expect(b.tryConsume(2, 0)).toBe(true);
    expect(b.tryConsume(1, 59_999)).toBe(false);
    expect(b.tryConsume(1, 60_000)).toBe(true);
  });

  it("warns at most once per window", () => {
    const b = new RollingBudget(1);
    expect(b.takeWarning(0)).toBe(true);
    expect(b.takeWarning(0)).toBe(false);
    expect(b.takeWarning(60_000)).toBe(true);
  });
});
