// Bottom-corner mini widget of the hero (rawatib bottom-right, adhkar
// bottom-left) — the lower mirror of the top SatelliteRings: title on top,
// 58px ring, caption below. In progress → depleting-style arc + "x/y" text
// inside; fully done → solid colour-filled disc + a nice bold check. Tapping
// opens the matching detail sheet.

import type { CSSProperties, ReactNode } from "react";
import { Check } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { cn } from "@/lib/utils";

interface CornerRingProps {
  label: string;
  caption: string;
  /** CSS colour string, e.g. "var(--color-sky)". */
  color: string;
  /** Physical pin — not flipped by RTL (matches the top satellites). */
  side: "left" | "right";
  /** 0..1 arc fill while in progress. */
  progress: number;
  /** Something is actionable right now → glow + full opacity. */
  active?: boolean;
  /** Fully done → solid disc + check; caption text stays unchanged. */
  complete?: boolean;
  onClick: () => void;
  /** Vertical pin class — top-anchored so it flanks the ring's lower arc
      regardless of what appears below the iqama bar. */
  posClass?: string;
  /** Dim (and grey the stroke) while idle. Default true; pass false to keep
      the ring at full presence even when nothing is actionable yet. */
  dimWhenIdle?: boolean;
  children: ReactNode;
}

export function CornerRing({
  label,
  caption,
  color,
  side,
  progress,
  active,
  complete,
  onClick,
  posClass = "bottom-9",
  dimWhenIdle = true,
  children,
}: CornerRingProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${caption}`}
      className={cn(
        "press absolute z-10 flex w-20 flex-col items-center gap-1.5",
        posClass,
        side === "right" ? "right-1" : "left-1",
        !active && !complete && dimWhenIdle && "opacity-60",
      )}
    >
      <span className="text-[11px] font-bold leading-none" style={{ color }}>
        {label}
      </span>
      {complete ? (
        <div
          className="satellite-done satellite-glow grid size-[58px] place-items-center rounded-full"
          style={{ "--sat": color } as CSSProperties}
        >
          <Check className="size-8" strokeWidth={4} />
        </div>
      ) : (
        <div
          className={cn("grid place-items-center rounded-full", active && "satellite-glow")}
          style={active ? ({ "--sat": color } as CSSProperties) : undefined}
        >
          <ProgressRing progress={progress} size={58} stroke={5} color={active || !dimWhenIdle ? color : "color-mix(in srgb, var(--color-veil) 20%, transparent)"}>
            {children}
          </ProgressRing>
        </div>
      )}
      <span className="max-w-20 truncate whitespace-nowrap pb-1 text-[10px] font-bold leading-normal" style={{ color }}>
        {caption}
      </span>
    </button>
  );
}
