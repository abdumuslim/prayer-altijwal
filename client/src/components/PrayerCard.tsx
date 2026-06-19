// One prayer row. Compact, pill-edged; the next prayer gets a proximity accent
// + inline colored countdown text (no progress bar). Passed prayers dim.

import { useI18n } from "@/i18n/I18nProvider";
import { proximityStyle } from "@/components/ui/proximity";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { formatCountdown, localizeTimeString, proximityFromMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";

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
        "group relative flex items-center gap-3.5 rounded-2xl border px-4 py-3 transition-all duration-300",
        isNext
          ? cn("bg-white/[0.06] border-transparent", style.border, style.glow)
          : "border-border-soft/60 bg-white/[0.02] hover:bg-white/[0.04]",
        prayer.isPassed && !isNext && "opacity-45",
      )}
    >
      {/* leading accent bar (logical: inline-start) */}
      {isNext && (
        <span
          className={cn(
            "absolute inset-y-2 start-0 w-1 rounded-full",
            style.dot,
          )}
          aria-hidden="true"
        />
      )}

      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl transition-colors",
          isNext ? cn("bg-white/10", style.text) : "bg-white/5 text-ink-dim",
        )}
      >
        <Icon className="size-5" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "truncate text-[0.95rem] font-semibold",
            isNext ? "text-ink" : "text-ink/90",
          )}
        >
          {prayer.label}
        </span>
        {isNext ? (
          <span className={cn("tnum text-xs font-medium", style.text)}>
            {prayer.msUntil <= 0
              ? t("next.now")
              : t("next.in", {
                  time: formatCountdown(prayer.timestamp ?? now, now, lang),
                })}
          </span>
        ) : (
          <span className="text-xs text-ink-faint">
            {prayer.isPassed ? t("next.passed") : ""}
          </span>
        )}
      </div>

      <span
        className={cn(
          "tnum shrink-0 text-sm font-semibold tracking-tight",
          isNext ? style.text : "text-ink/80",
        )}
      >
        {localizeTimeString(prayer.time, lang)}
      </span>
    </div>
  );
}
