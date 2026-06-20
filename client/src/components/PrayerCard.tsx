// One prayer box for the 2-column grid — a single vertically-centered row:
//   [icon · name]  at the start,  [clock time / remaining] stacked at the end.
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
        "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 transition-colors",
        isNext
          ? cn("border-transparent bg-white/[0.06]", style.border, proximity !== "safe" && style.glow)
          : "border-border-soft/60 bg-white/[0.02]",
        prayer.isPassed && !isNext && "opacity-45",
      )}
    >
      {/* start: icon + prayer name */}
      <div className="flex min-w-0 items-center gap-2">
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

      {/* end: clock time over remaining countdown — centred stacked column */}
      <div className="flex shrink-0 flex-col items-center gap-0.5 leading-tight">
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
