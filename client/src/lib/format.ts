// Client-side localized formatting: countdown recomputed from a target
// timestamp, Arabic-Indic vs Latin numerals (consistent within a language), and
// proximity levels for styling. Mirrors the home hook's semantics.

import type { Lang } from "@/types/api";

const ARABIC_INDIC = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Convert Latin digits in a string to the numeral system for `lang`. */
export function localizeDigits(input: string, lang: Lang): string {
  if (lang !== "ar") return input;
  return input.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

/** Localize a whole number. */
export function localizeNumber(n: number, lang: Lang): string {
  return localizeDigits(String(n), lang);
}

export type Proximity =
  | "imminent" // <= 2 min
  | "critical" // <= 4 min
  | "urgent" // <= 7 min
  | "warning" // <= 15 min
  | "safe";

/** Proximity bucket from minutes remaining (mirrors home + FRONTEND.md §2). */
export function proximityFromMs(ms: number): Proximity {
  const minutes = ms / 60_000;
  if (minutes <= 2) return "imminent";
  if (minutes <= 4) return "critical";
  if (minutes <= 7) return "urgent";
  if (minutes <= 15) return "warning";
  return "safe";
}

export interface CountdownParts {
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
}

export function countdownParts(targetTs: number, now: number): CountdownParts {
  const totalMs = Math.max(0, targetTs - now);
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalMs,
  };
}

/**
 * Compact localized countdown string recomputed each tick:
 *   > 1h   →  "2h 5m"  / "٢س ٥د"
 *   < 1h   →  "45m 12s" / "٤٥د ١٢ث"
 *   < 1m   →  "30s" / "٣٠ث"
 */
export function formatCountdown(
  targetTs: number,
  now: number,
  lang: Lang,
): string {
  const { hours, minutes, seconds } = countdownParts(targetTs, now);
  const u =
    lang === "ar"
      ? { h: "س", m: "د", s: "ث" }
      : { h: "h", m: "m", s: "s" };

  let out: string;
  if (hours > 0) {
    out = `${hours}${u.h} ${minutes}${u.m}`;
  } else if (minutes > 0) {
    out = `${minutes}${u.m} ${seconds}${u.s}`;
  } else {
    out = `${seconds}${u.s}`;
  }
  return localizeDigits(out, lang);
}

/**
 * Big hero timer with leading zeros: "01:24:53" or "24:53".
 * Always tabular; numerals localized.
 */
export function formatHeroClock(
  targetTs: number,
  now: number,
  lang: Lang,
): string {
  const { hours, minutes, seconds } = countdownParts(targetTs, now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const base =
    hours > 0
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  return localizeDigits(base, lang);
}

/**
 * Fraction (0..1) elapsed of the interval [from, to] at `now`, for a progress
 * ring. Clamped. When `from` is null, falls back to a fixed soft fill.
 */
export function intervalProgress(
  from: number | null,
  to: number,
  now: number,
): number {
  if (from == null || to <= from) return 0;
  const frac = (now - from) / (to - from);
  return Math.min(1, Math.max(0, frac));
}

/** Re-localize a server-formatted time string (e.g. "4:18 AM") for `lang`. */
export function localizeTimeString(time: string, lang: Lang): string {
  return localizeDigits(time, lang);
}
