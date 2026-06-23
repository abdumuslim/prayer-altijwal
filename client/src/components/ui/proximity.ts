// Maps a Proximity level to Tailwind classes for the countdown accent. Kept in
// one place so the hero, the next-prayer card, and the list stay consistent.

import type { Proximity } from "@/lib/format";

export interface ProximityStyle {
  text: string;
  ring: string; // stroke colour for SVG ring (hex var); also feeds the breath glow via --prox
  border: string;
  dot: string;
}

// Palette tracks time-left: green (safe) → yellow (warning) → orange (urgent) →
// red (critical) → pulsing red (imminent). The next-prayer card's glow breathes
// off the shared --breath, tinted by `ring`; no per-state glow class needed.
const STYLES: Record<Proximity, ProximityStyle> = {
  imminent: {
    text: "text-imminent",
    ring: "var(--color-imminent)",
    border: "border-imminent/60",
    dot: "bg-imminent",
  },
  critical: {
    text: "text-critical",
    ring: "var(--color-critical)",
    border: "border-critical/50",
    dot: "bg-critical",
  },
  urgent: {
    text: "text-urgent",
    ring: "var(--color-urgent)",
    border: "border-urgent/45",
    dot: "bg-urgent",
  },
  warning: {
    text: "text-warning",
    ring: "var(--color-warning)",
    border: "border-warning/40",
    dot: "bg-warning",
  },
  safe: {
    text: "text-safe",
    ring: "var(--color-safe)",
    border: "border-safe/35",
    dot: "bg-safe",
  },
};

export function proximityStyle(p: Proximity): ProximityStyle {
  return STYLES[p];
}
