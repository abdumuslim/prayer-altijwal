// Hero live timer to the next prayer: a single header line + a progress ring
// (depleting across the interval) holding the prayer name, the live countdown,
// and the prayer's clock time. Kept vertically compact so it fits on a phone.

import { useMemo } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { proximityStyle } from "@/components/ui/proximity";
import {
  formatCountdown,
  intervalProgress,
  localizeTimeString,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DerivedNext } from "@/hooks/usePrayerTimes";
import type { StringKey } from "@/i18n/strings.en";

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
      <section className="card arabesque animate-rise-in flex min-h-[220px] items-center justify-center p-8 text-center">
        <p className="text-ink-dim">{t("loading.times")}</p>
      </section>
    );
  }

  const clock = formatCountdown(next.timestamp, now, lang);
  const progress = intervalProgress(next.intervalStart, next.timestamp, now);
  const ringProgress = 1 - progress; // depletes as time passes

  return (
    <section className="card arabesque animate-rise-in relative overflow-hidden p-4 sm:p-5">
      {/* soft radial accent behind the ring — physical `left-1/2` so it stays
          centred under both LTR and RTL. Breathes (scale + opacity) off the shared
          --breath so it stays in lockstep with the next-prayer card. */}
      <div
        className="halo-breath pointer-events-none absolute -top-24 left-1/2 h-80 w-80 rounded-full blur-3xl"
        style={{ background: style.ring }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center gap-2.5">
        <div className="flex items-center justify-center gap-2 text-center">
          <span className={cn("text-base font-semibold", style.text)}>
            {next.msUntil <= 0 ? t("next.now") : t("next.header")}
          </span>
          {next.tomorrow && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[12px] font-medium text-ink-dim">
              {t("next.tomorrow")}
            </span>
          )}
        </div>

        <ProgressRing
          progress={ringProgress}
          size={208}
          stroke={10}
          color={style.ring}
        >
          {/* Height-constrained column so the three lines breathe (justify-between)
              while staying inside the ring's inscribed area — never touching it. */}
          <div className="flex h-[58%] flex-col items-center justify-between text-center">
            <span className="text-3xl font-bold leading-none text-gold">
              {t(`prayer.${next.name}` as StringKey)}
            </span>
            <span
              className={cn(
                "tnum text-[2.1rem] font-extrabold leading-none tracking-tight",
                style.text,
              )}
            >
              {clock}
            </span>
            <span className="text-base leading-none text-ink-dim">
              {localizeTimeString(next.time, lang)}
            </span>
          </div>
        </ProgressRing>
      </div>
    </section>
  );
}
