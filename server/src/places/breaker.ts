/**
 * Rolling-window upstream call budget (ADR-011).
 *
 * Extracted from the masjid handler's closure because BOTH paid endpoints now
 * meter against it: the masjid search (1 unit per cache miss) and the on-expand
 * travel lookup (2 units — WALK + DRIVE). It bounds a BURST; the persistent
 * daily/monthly governor in budget.ts bounds the VOLUME. Neither replaces the
 * GCP-side quota cap, which stays the hard billing backstop.
 */
export class RollingBudget {
  private windowStart = 0;
  private used = 0;
  private warned = false;

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number = 60_000,
  ) {}

  private roll(now: number): void {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.used = 0;
      this.warned = false;
    }
  }

  /** Reserve `units` if the window has room. Returns false without spending. */
  tryConsume(units: number, now: number = Date.now()): boolean {
    this.roll(now);
    if (this.used + units > this.maxPerWindow) return false;
    this.used += units;
    return true;
  }

  /** True at most once per window — keeps a tripped breaker from flooding logs. */
  takeWarning(now: number = Date.now()): boolean {
    this.roll(now);
    if (this.warned) return false;
    this.warned = true;
    return true;
  }

  /** Units still available in the current window (for telemetry). */
  remaining(now: number = Date.now()): number {
    this.roll(now);
    return Math.max(0, this.maxPerWindow - this.used);
  }
}
