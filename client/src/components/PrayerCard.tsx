// One prayer box for the 2-column grid. Two horizontal rows that use the cell's
// full width: [icon · name] on top, [clock time · remaining countdown] below.
// Every UPCOMING prayer shows its live remaining time (not just the next one);
// the next prayer carries the proximity accent, the rest stay calm, passed dim.

import { useI18n } from "@/i18n/I18nProvider";
import { proximityStyle } from "@/components/ui/proximity";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { formatCountdown, localizeTimeString, proximityFromMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";
import type { StringKey } from "@/i18n/strings.en";

interface PrayerCardProps {
  prayer: DerivedPrayer;
  now: number;
}

export function PrayerCard({ prayer, now }: PrayerCardProps) {
  const { t, lang } = useI18n();
  const Icon = PRAYER_ICONS[prayer.name];
  const isNext = prayer.isNext;
  const isUpcoming = prayer.msUntil > 0;
  const proximity = isNext ? proximityFromMs(prayer.msUntil) : "safe";
  const style = proximityStyle(proximity);

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border px-2.5 py-2 transition-colors",
        isNext
          ? cn("border-transparent bg-white/[0.06]", style.border, proximity !== "safe" && style.glow)
          : "border-border-soft/60 bg-white/[0.02]",
        prayer.isPassed && !isNext && "opacity-45",
      )}
    >
      {/* row 1: icon + prayer name */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            isNext ? cn("bg-white/10", style.text) : "bg-white/5 text-ink-dim",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span
          className={cn(
            "truncate text-sm font-semibold leading-none",
            isNext ? "text-ink" : "text-ink/90",
          )}
        >
          {t(`prayer.${prayer.name}` as StringKey)}
        </span>
      </div>

      {/* row 2: clock time + remaining countdown (all upcoming prayers) */}
      <div className="flex items-baseline justify-between gap-1">
        <span className="tnum text-xs text-ink-dim">
          {localizeTimeString(prayer.time, lang)}
        </span>
        {isUpcoming && (
          <span
            className={cn(
              "tnum text-[0.72rem] font-semibold leading-none",
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
