// One prayer box for the 2-column grid — a single vertically-centered row:
//   [icon · name]  at the start,  [clock time / remaining] stacked at the end.
// Every UPCOMING prayer shows its live remaining time (not just the next one);
// the next prayer carries the proximity accent, the rest stay calm, passed dim.

import type { CSSProperties } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { CheckinControl } from "@/components/CheckinControl";
import { proximityStyle } from "@/components/ui/proximity";
import { formatCountdown, localizeTimeString, proximityFromMs } from "@/lib/format";
import { prayerNameKey } from "@/lib/prayer-names";
import { cn } from "@/lib/utils";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";
import type { FardState } from "@/lib/worship-log";

export interface CardCheckin {
  state: FardState;
  /** The mark window is open (adhan passed, still today). */
  enabled: boolean;
  onMark: (state: FardState) => void;
}

interface PrayerCardProps {
  prayer: DerivedPrayer;
  now: number;
  /** Worship check-in control (fard prayers only). */
  checkin?: CardCheckin | null;
  /** Location-tz civil day is a Friday → dhuhr renders as الجمعة. */
  isFriday?: boolean;
}

export function PrayerCard({ prayer, now, checkin, isFriday }: PrayerCardProps) {
  const { t, lang } = useI18n();
  const isNext = prayer.isNext;
  const isUpcoming = prayer.msUntil > 0;
  const proximity = isNext ? proximityFromMs(prayer.msUntil) : "safe";
  const style = proximityStyle(proximity);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-5 transition-colors",
        // The next prayer breathes in lockstep with the hero halo (shared --breath),
        // tinted by its proximity accent via --prox; the rest stay calm.
        isNext
          ? cn("breath-glow border-transparent bg-white/[0.06]", style.border)
          : "border-border-soft/60 bg-white/[0.02]",
        prayer.isPassed && !isNext && "opacity-45",
      )}
      style={isNext ? ({ "--prox": style.ring } as CSSProperties) : undefined}
    >
      {/* start: prayer name, with the check-in icon right after it */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "truncate text-lg font-semibold leading-snug",
            isNext ? "text-ink" : "text-ink/90",
          )}
        >
          {t(prayerNameKey(prayer.name, !!isFriday))}
        </span>
        {checkin && (
          <CheckinControl state={checkin.state} enabled={checkin.enabled} onMark={checkin.onMark} />
        )}
      </div>

      {/* end: clock time over remaining countdown — centred stacked column */}
      <div className="flex shrink-0 flex-col items-center gap-0.5 leading-tight">
        <span className="tnum text-sm text-ink-dim">
          {localizeTimeString(prayer.time, lang)}
        </span>
        {isUpcoming && (
          <span
            className={cn(
              "tnum text-[0.84rem] font-semibold leading-none",
              isNext ? style.text : "text-ink-dim",
            )}
          >
            {formatCountdown(prayer.timestamp ?? now, now, lang)}
          </span>
        )}
      </div>
    </div>
  );
}
