// Maps a Proximity level to Tailwind classes for the countdown accent. Kept in
// one place so the hero, the next-prayer card, and the list stay consistent.

import type { Proximity } from "@/lib/format";

export interface ProximityStyle {
  text: string;
  ring: string; // stroke colour for SVG ring (hex var)
  glow: string; // box-shadow / animation utility classes
  border: string;
  dot: string;
}

const STYLES: Record<Proximity, ProximityStyle> = {
  imminent: {
    text: "text-imminent",
    ring: "var(--color-imminent)",
    glow: "animate-imminent-pulse",
    border: "border-imminent/60",
    dot: "bg-imminent",
  },
  critical: {
    text: "text-critical",
    ring: "var(--color-critical)",
    glow: "shadow-[0_0_24px_-6px_rgba(251,146,60,0.6)]",
    border: "border-critical/50",
    dot: "bg-critical",
  },
  urgent: {
    text: "text-urgent",
    ring: "var(--color-urgent)",
    glow: "shadow-[0_0_22px_-6px_rgba(245,196,81,0.55)]",
    border: "border-urgent/45",
    dot: "bg-urgent",
  },
  warning: {
    text: "text-warning",
    ring: "var(--color-warning)",
    glow: "shadow-[0_0_20px_-8px_rgba(52,211,153,0.5)]",
    border: "border-warning/40",
    dot: "bg-warning",
  },
  safe: {
    text: "text-teal",
    ring: "var(--color-safe)",
    glow: "shadow-[0_0_18px_-8px_rgba(45,212,191,0.45)]",
    border: "border-teal/30",
    dot: "bg-teal",
  },
};

export function proximityStyle(p: Proximity): ProximityStyle {
  return STYLES[p];
}
