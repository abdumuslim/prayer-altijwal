import { describe, expect, test } from "vitest";
import { addDays, localDayKey, monthKeyOf, prevDayKey } from "./civil-day";

// 2026-07-03T22:30Z — already "tomorrow" in Baghdad (+03), still "today" in NY (−04).
const LATE_UTC = Date.UTC(2026, 6, 3, 22, 30, 0);

describe("localDayKey", () => {
  test("uses the target tz, not the device tz", () => {
    expect(localDayKey("Asia/Baghdad", LATE_UTC)).toBe("2026-07-04");
    expect(localDayKey("America/New_York", LATE_UTC)).toBe("2026-07-03");
  });

  test("falls back without throwing on an invalid tz", () => {
    expect(localDayKey("Not/AZone", LATE_UTC)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDays / prevDayKey", () => {
  test("crosses month boundaries", () => {
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(prevDayKey("2026-07-01")).toBe("2026-06-30");
  });

  test("crosses year boundaries", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(prevDayKey("2026-01-01")).toBe("2025-12-31");
  });

  test("handles leap days", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  test("shifts by multiple days (retention horizon math)", () => {
    expect(addDays("2026-07-03", -62)).toBe("2026-05-02");
  });
});

describe("monthKeyOf", () => {
  test("truncates a day key to its month", () => {
    expect(monthKeyOf("2026-07-03")).toBe("2026-07");
  });
});
