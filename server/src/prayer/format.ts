import type { Lang } from "./events.js";

const DAY_MS = 86_400_000;

export function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Format an instant as a clock time in the TARGET location's tz (never the
 * device tz). Numerals are always Latin (product decision: "keep numbers in
 * English"); Arabic still gets its localized AM/PM markers (ص/م) via the
 * `ar-u-nu-latn` locale (Latin numbering system + Arabic text).
 */
export function fmtTime(date: Date, tz: string, lang: Lang): string {
  if (!isValidDate(date)) return "—";
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : "en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/**
 * Human countdown for a positive millisecond delta. Returns null if the moment
 * has passed. Neutral Latin form ("2h 5m" / "45m 12s" / "30s") — used for first
 * paint; the client recomputes + localizes each tick.
 */
export function fmtCountdown(ms: number): string | null {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Civil date key (YYYY-MM-DD) for an instant in the given IANA tz. */
export function dateKey(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Minute-of-day (0–1439) for an instant in the given IANA tz. */
export function minuteOfDay(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return (hh % 24) * 60 + mm;
}

/**
 * An instant guaranteed to fall on the civil date `YYYY-MM-DD` in `tz` (anchored
 * near local noon). Starts from noon UTC and corrects for the tz offset so even
 * extreme zones (UTC+14 / UTC−12) resolve to the right civil day. The engine
 * then re-anchors this to local midnight via its own zonedMidnightUtc.
 */
export function instantForCivilDate(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const local = dateKey(guess, tz);
  if (local !== dateStr) {
    const diffDays = Math.round(
      (Date.parse(`${dateStr}T00:00:00Z`) - Date.parse(`${local}T00:00:00Z`)) / DAY_MS,
    );
    guess = new Date(guess.getTime() + diffDays * DAY_MS);
  }
  return guess;
}
