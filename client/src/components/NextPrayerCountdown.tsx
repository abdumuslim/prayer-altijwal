// Hero live timer to the next prayer: a single header line + a progress ring
// (depleting across the interval) holding the prayer name, the live countdown,
// and the prayer's clock time. Kept vertically compact so it fits on a phone.

import { useMemo, type CSSProperties } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { proximityStyle } from "@/components/ui/proximity";
import {
  formatCountdown,
  glowBreathPeriod,
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
  const isImminent = next.proximity === "imminent";
  // Always-on breathing glow: colour follows the proximity accent, speed ramps
  // from a calm slow breath (far off) to the last-minute pulse. The last minute
  // keeps its dedicated red imminent-pulse.
  const breathPeriod = glowBreathPeriod(next.msUntil);

  return (
    <section
      className="card arabesque relative overflow-hidden p-4 sm:p-5"
      style={
        {
          "--glow-c": style.ring,
          "--glow-period": `${breathPeriod.toFixed(2)}s`,
          // Compose the one-shot entrance with the looping glow in a SINGLE
          // `animation` list. Two separate animation utilities (e.g.
          // `animate-rise-in` + `animate-glow-breath`) both set the `animation`
          // shorthand, so only one wins and the glow silently never runs.
          animation: isImminent
            ? "var(--animate-rise-in), var(--animate-imminent-pulse)"
            : "var(--animate-rise-in), var(--animate-glow-breath)",
        } as CSSProperties
      }
    >
      {/* soft radial accent behind the ring — physical `left-1/2` so it stays
          centred under both LTR and RTL. Breathes in sync via the inherited
          `--glow-period` (opacity pulse). */}
      <div
        className="halo-breath pointer-events-none absolute -top-20 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: style.ring }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center gap-2.5">
        <div className="flex items-center justify-center gap-2 text-center">
          <span className={cn("text-sm font-semibold", style.text)}>
            {next.msUntil <= 0 ? t("next.now") : t("next.header")}
          </span>
          {next.tomorrow && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-ink-dim">
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
            <span className="text-2xl font-bold leading-none text-gold">
              {t(`prayer.${next.name}` as StringKey)}
            </span>
            <span
              className={cn(
                "tnum text-[1.85rem] font-extrabold leading-none tracking-tight",
                style.text,
                isImminent && "animate-soft-pulse",
              )}
            >
              {clock}
            </span>
            <span className="text-sm leading-none text-ink-dim">
              {localizeTimeString(next.time, lang)}
            </span>
          </div>
        </ProgressRing>
      </div>
    </section>
  );
}
