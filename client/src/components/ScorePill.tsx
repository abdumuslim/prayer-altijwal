// Today's score + streak, pinned to the hero's top corner. Tapping opens the
// stats sheet. Kept tiny and calm — ambient gamification, not a distraction.

import type { CSSProperties } from "react";
import { Flame, Star } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

interface ScorePillProps {
  points: number;
  streak: number;
  onClick: () => void;
  className?: string;
}

export function ScorePill({ points, streak, onClick, className }: ScorePillProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      // Without a label TalkBack reads the bare digits ("3 5"). Hit area capped
      // at 38px: a full 48px expansion would overlap the Qiyam satellite button
      // (RTL top-start corner) — documented Phase-8 exception; the Reports tab
      // is the redundant path to the same place.
      aria-label={t("track.scoreLabel", { points: String(points), streak: String(streak) })}
      className={cn(
        "hit-target flex items-center gap-1.5 rounded-full border border-gold/30 bg-veil/[0.04] px-2 py-1 leading-none",
        "transition-colors hover:bg-veil/[0.08]",
        className,
      )}
      style={{ "--hit-h": "max(100%, 38px)" } as CSSProperties}
    >
      <Star className="size-3.5 text-gold" fill="currentColor" />
      <span className="tnum text-[13px] font-extrabold text-gold">{points}</span>
      <span className="h-3 w-px bg-veil/15" />
      <Flame className="size-3.5 text-urgent" />
      <span className="tnum text-[13px] font-bold text-urgent">{streak}</span>
    </button>
  );
}
