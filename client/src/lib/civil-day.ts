// Civil-day key arithmetic. A DayKey is "YYYY-MM-DD" — the civil date in the
// TARGET LOCATION's IANA tz (never the device tz — ARCHITECTURE §3). Once a
// key exists it is a plain calendar date: addDays/prevDayKey are pure Gregorian
// string math and never touch any timezone.

/** Local civil-day key in a given IANA tz (YYYY-MM-DD). */
export function localDayKey(tz: string, at: number = Date.now()): string {
  try {
    // en-CA formats as YYYY-MM-DD (same helper the countdown hook uses).
    return new Date(at).toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date(at).toLocaleDateString("en-CA");
  }
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Shift a DayKey by n calendar days (pure Gregorian math, tz-free). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** The calendar day before `key`. */
export function prevDayKey(key: string): string {
  return addDays(key, -1);
}

/** "YYYY-MM-DD" → "YYYY-MM". */
export function monthKeyOf(key: string): string {
  return key.slice(0, 7);
}
