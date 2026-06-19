// One compact prayer box for the 2-column grid. Stacked + centered: icon, name,
// clock time, and (for the next prayer) the live remaining countdown.

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
  const proximity = isNext ? proximityFromMs(prayer.msUntil) : "safe";
  const style = proximityStyle(proximity);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-xl border px-2 py-3 text-center transition-colors",
        isNext
          ? cn("border-transparent bg-white/[0.06]", style.border, proximity !== "safe" && style.glow)
          : "border-border-soft/60 bg-white/[0.02]",
        prayer.isPassed && !isNext && "opacity-45",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          isNext ? cn("bg-white/10", style.text) : "bg-white/5 text-ink-dim",
        )}
      >
        <Icon className="size-4.5" />
      </span>

      <span
        className={cn(
          "text-sm font-semibold leading-none",
          isNext ? "text-ink" : "text-ink/90",
        )}
      >
        {t(`prayer.${prayer.name}` as StringKey)}
      </span>

      <span className="tnum text-xs text-ink-dim">
        {localizeTimeString(prayer.time, lang)}
      </span>

      {isNext && (
        <span className={cn("tnum text-[0.72rem] font-semibold leading-none", style.text)}>
          {formatCountdown(prayer.timestamp ?? now, now, lang)}
        </span>
      )}
    </div>
  );
}
