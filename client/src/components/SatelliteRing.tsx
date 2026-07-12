// A small Sunnah-time satellite pinned to a top corner of the hero card (Duha
// top-right, Qiyam top-left). Reuses the main ProgressRing. When active it glows
// with a depleting arc + countdown to the window end; when inactive it is dimmed
// (but readable) and counts down to the next window's start.

import type { CSSProperties } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { formatCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SatelliteState } from "@/lib/hero-extras";
import type { Lang } from "@/types/api";

interface SatelliteRingProps {
  icon: LucideIcon;
  /** Localized short name (also part of the aria label). */
  label: string;
  state: SatelliteState;
  /** CSS color string, e.g. "var(--color-amber)". */
  color: string;
  /** Physical pin — fixed regardless of dir (left/right are not flipped by RTL). */
  side: "left" | "right";
  now: number;
  lang: Lang;
  /** The worship was logged: solid colour-filled disc + check instead of the ring.
      The caption below keeps its normal text (user note: only the circle changes). */
  done?: boolean;
  onClick?: () => void;
}

export function SatelliteRing({
  icon: Icon,
  label,
  state,
  color,
  side,
  now,
  lang,
  done,
  onClick,
}: SatelliteRingProps) {
  const { active, target, progress } = state;
  // Same countdown format as the hero + prayer list (h/m/s units, zero-padded).
  const time = formatCountdown(target, now, lang);
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        // Sit beside the upper part of the main ring (not up by the header, not
        // centred) — high/outset enough that the timer caption clears the ring's curve.
        "pointer-events-auto absolute top-6 z-10 flex w-20 flex-col items-center gap-1.5",
        side === "right" ? "right-1" : "left-1",
        !active && !done && "opacity-50 grayscale-[0.35]",
      )}
      aria-label={`${label}: ${time}`}
    >
      <span className="text-[11px] font-bold leading-none" style={{ color }}>
        {label}
      </span>
      {done ? (
        <div
          className="satellite-glow grid size-[58px] place-items-center rounded-full"
          style={{ background: color, "--sat": color } as CSSProperties}
        >
          <Check className="size-8 text-on-accent" strokeWidth={4} />
        </div>
      ) : (
        <div
          className={cn("grid place-items-center rounded-full", active && "satellite-glow")}
          style={active ? ({ "--sat": color } as CSSProperties) : undefined}
        >
          <ProgressRing
            progress={progress}
            size={58}
            stroke={5}
            color={active ? color : "color-mix(in srgb, var(--color-veil) 14%, transparent)"}
          >
            <Icon className="size-5" style={{ color: active ? color : "var(--color-ink-faint)" }} />
          </ProgressRing>
        </div>
      )}
      {/* When the window isn't active the time points at the NEXT day's window —
          keep it disabled-looking even when the disc itself shows done. */}
      <span
        className={cn(
          "tnum whitespace-nowrap text-[11px] font-bold leading-none",
          !active && "opacity-50",
        )}
        style={{ color }}
      >
        {time}
      </span>
    </Wrapper>
  );
}
