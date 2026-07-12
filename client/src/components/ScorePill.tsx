// Today's score + streak, pinned to the hero's top corner. Tapping opens the
// stats sheet. Kept tiny and calm — ambient gamification, not a distraction.

import { Flame, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScorePillProps {
  points: number;
  streak: number;
  onClick: () => void;
  className?: string;
}

export function ScorePill({ points, streak, onClick, className }: ScorePillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-gold/30 bg-veil/[0.04] px-2 py-1 leading-none",
        "transition-colors hover:bg-veil/[0.08]",
        className,
      )}
    >
      <Star className="size-3.5 text-gold" fill="currentColor" />
      <span className="tnum text-[13px] font-extrabold text-gold">{points}</span>
      <span className="h-3 w-px bg-veil/15" />
      <Flame className="size-3.5 text-urgent" />
      <span className="tnum text-[13px] font-bold text-urgent">{streak}</span>
    </button>
  );
}
