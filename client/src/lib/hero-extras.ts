// Pure derivation for the hero card's secondary worship-time aids: the Duha /
// Qiyam satellite rings and the post-adhan iqama bar. Side-effect free and kept
// out of render bodies so the math stays simple and independently checkable.

import type { PrayerName, SunnahWindow } from "@/types/api";
import type { IqamaMinutes, IqamaPrayer } from "@/lib/storage";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export interface SatelliteState {
  /** True while `now` is inside [start, end]. */
  active: boolean;
  /** The instant we count down to: the window end when active, else its start. */
  target: number;
  /** ms until `target` (never negative). */
  msUntil: number;
  /** 0..1 ring fill — full at the start of an active window, depleting to 0 at its end. */
  progress: number;
}

/**
 * Satellite view-model from a server-selected window. Returns null when there is
 * no window (high latitude) or it has already ended (stale — `usePrayerTimes`
 * refetches the next one), so the caller simply renders nothing.
 */
export function deriveSatellite(w: SunnahWindow | null, now: number): SatelliteState | null {
  if (!w || now >= w.end) return null;
  if (now >= w.start) {
    const frac = (now - w.start) / (w.end - w.start);
    return { active: true, target: w.end, msUntil: w.end - now, progress: 1 - clamp01(frac) };
  }
  return { active: false, target: w.start, msUntil: w.start - now, progress: 0 };
}

export interface IqamaState {
  prayer: IqamaPrayer;
  /** The iqama instant (adhan + the configured minutes). */
  iqamaTs: number;
  /** True in the final 60s before iqama — the bar blinks. */
  blinking: boolean;
  /** ms until iqama (never negative). */
  msUntil: number;
  /** 0..1 bar fill — full at adhan, depleting to 0 at iqama. */
  progress: number;
}

function isIqamaPrayer(name: PrayerName): name is IqamaPrayer {
  return name !== "sunrise";
}

/**
 * Iqama-bar view-model. Visible only between a prayer's adhan and its iqama
 * (sunrise excluded — it has no iqama); blinks in the final minute; null once
 * iqama is reached or before any adhan. Iqama windows are short and prayers are
 * hours apart, so at most one matches at a time. A 0-minute setting never shows
 * a bar (and never divides by zero — the half-open window is empty).
 */
export function deriveIqama(
  prayers: { name: PrayerName; timestamp: number | null }[],
  mins: IqamaMinutes,
  now: number,
): IqamaState | null {
  for (const p of prayers) {
    if (p.timestamp == null || !isIqamaPrayer(p.name)) continue;
    const adhanTs = p.timestamp;
    const iqamaTs = adhanTs + mins[p.name] * 60_000;
    if (now >= adhanTs && now < iqamaTs) {
      const msUntil = iqamaTs - now;
      return {
        prayer: p.name,
        iqamaTs,
        blinking: msUntil <= 60_000,
        msUntil,
        progress: 1 - clamp01((now - adhanTs) / (iqamaTs - adhanTs)),
      };
    }
  }
  return null;
}
