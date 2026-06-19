// Hero live timer to the next prayer. Big tabular clock inside a progress ring
// that depletes across the current interval, with a proximity-tinted glow.

import { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { proximityStyle } from "@/components/ui/proximity";
import {
  formatHeroClock,
  intervalProgress,
  localizeTimeString,
} from "@/lib/format";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import type { DerivedNext } from "@/hooks/usePrayerTimes";
import type { PrayerName } from "@/types/api";

interface NextPrayerCountdownProps {
  next: DerivedNext | null;
  now: number;
}

export function NextPrayerCountdown({ next, now }: NextPrayerCountdownProps) {
  const { t, lang } = useI18n();

  const style = useMemo(
    () => proximityStyle(next?.proximity ?? "safe"),
    [next?.proximity],
  );

  if (!next) {
    return (
      <section className="card arabesque animate-rise-in flex min-h-[260px] items-center justify-center p-8 text-center">
        <p className="text-ink-dim">{t("loading.times")}</p>
      </section>
    );
  }

  const Icon = PRAYER_ICONS[next.name as PrayerName] ?? PRAYER_ICONS.fajr;
  const clock = formatHeroClock(next.timestamp, now, lang);
  const progress = intervalProgress(next.intervalStart, next.timestamp, now);
  const ringProgress = 1 - progress; // depletes as time passes
  const isImminent = next.proximity === "imminent";

  return (
    <section
      className={cn(
        "card arabesque animate-rise-in relative overflow-hidden p-6 sm:p-8",
        isImminent ? style.glow : "animate-glow-pulse",
      )}
    >
      {/* soft radial accent behind the ring */}
      <div
        className="pointer-events-none absolute -top-24 start-1/2 h-64 w-64 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: style.ring }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center gap-5">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold tracking-wide",
              style.border,
              style.text,
              "bg-white/5 backdrop-blur",
            )}
          >
            <Icon className="size-4" />
            {t("next.label")}
          </span>
          {next.tomorrow && (
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-ink-dim">
              {t("next.tomorrow")}
            </span>
          )}
        </div>

        <ProgressRing
          progress={ringProgress}
          size={224}
          stroke={10}
          color={style.ring}
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-2xl font-bold text-gold sm:text-[1.7rem]">
              {next.label}
            </span>
            <span
              className={cn(
                "tnum text-4xl font-extrabold leading-none sm:text-5xl",
                style.text,
                isImminent && "animate-soft-pulse",
              )}
            >
              {clock}
            </span>
            <span className="mt-1 text-sm text-ink-dim">
              {localizeTimeString(next.time, lang)}
            </span>
          </div>
        </ProgressRing>

        <p className={cn("text-sm font-medium", style.text)}>
          {next.msUntil <= 0 ? t("next.now") : t("next.remaining")}
        </p>
      </div>
    </section>
  );
}
