// Client-side localized formatting: countdown recomputed from a target
// timestamp, Arabic-Indic vs Latin numerals (consistent within a language), and
// proximity levels for styling. Mirrors the home hook's semantics.

import type { Lang } from "@/types/api";

/**
 * Numerals are ALWAYS rendered in Latin digits — even in Arabic — per the
 * product decision "keep numbers in English". Kept as a pass-through (rather
 * than deleting every call site) so the rest of the formatting code is stable.
 */
export function localizeDigits(input: string, _lang: Lang): string {
  return input;
}

/** A whole number as a Latin-digit string. */
export function localizeNumber(n: number, _lang: Lang): string {
  return String(n);
}

export type Proximity =
  | "imminent" // <= 1 min  → pulsing red
  | "critical" // <= 5 min  → red
  | "urgent" //   <= 10 min → orange
  | "warning" //  <= 15 min → yellow
  | "safe"; //    > 15 min  → green

/**
 * Proximity bucket from minutes remaining. Drives the countdown vibe colour:
 * green (>15) → yellow (≤15) → orange (≤10) → red (≤5) → pulsing red (≤1), then
 * resets to green when the next prayer's countdown begins. See FRONTEND.md §2.
 */
export function proximityFromMs(ms: number): Proximity {
  const minutes = ms / 60_000;
  if (minutes <= 1) return "imminent";
  if (minutes <= 5) return "critical";
  if (minutes <= 10) return "urgent";
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
 * Compact localized countdown string recomputed each tick. Spaced unit labels
 * joined by a colon; seconds dropped once an hour remains. Every numeric value
 * is zero-padded to **2 digits** so the tabular-figure width never changes and
 * the text doesn't shift as the digits tick:
 *   > 1h   →  "02 h : 05 m" / "02 س : 05 د"
 *   < 1h   →  "59 m : 19 s" / "59 د : 19 ث"
 *   < 1m   →  "05 s" / "05 ث"
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
  const pad = (n: number): string => String(n).padStart(2, "0");

  let out: string;
  if (hours > 0) {
    out = `${pad(hours)} ${u.h} : ${pad(minutes)} ${u.m}`;
  } else if (minutes > 0) {
    out = `${pad(minutes)} ${u.m} : ${pad(seconds)} ${u.s}`;
  } else {
    out = `${pad(seconds)} ${u.s}`;
  }
  return localizeDigits(out, lang);
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
