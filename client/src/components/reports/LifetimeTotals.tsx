// Reports · lifetime totals — points / days logged / perfect days / best day
// across folds + retained days, in the approved 4-tile row (LTR grid keeps the
// divider order stable while each tile stays RTL). When the best day is a
// retained day its date is shown in a footer; a fold's record has no date.

import { Check, Flame, Star, Trophy } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { LEVANTINE_MONTHS_AR } from "@/lib/gregorian";
import type { WorshipStats } from "@/lib/worship-stats";
import type { ReactNode } from "react";

interface LifetimeTotalsProps {
  stats: WorshipStats;
}

/** "YYYY-MM-DD" → «D تموز YYYY» — the app's Levantine month set, Latin digits. */
function formatBestDay(dayKey: string): string {
  const month = LEVANTINE_MONTHS_AR[Number(dayKey.slice(5, 7)) - 1];
  if (!month) return dayKey;
  return `${Number(dayKey.slice(8, 10))} ${month} ${dayKey.slice(0, 4)}`;
}

export function LifetimeTotals({ stats }: LifetimeTotalsProps) {
  const { t } = useI18n();

  const tiles: { icon: ReactNode; value: number; label: string }[] = [
    { icon: <Star className="size-4 text-gold" />, value: stats.totals.points, label: t("reports.points") },
    { icon: <Check className="size-4 text-emerald" />, value: stats.totals.daysLogged, label: t("reports.daysLogged") },
    { icon: <Flame className="size-4 text-urgent" />, value: stats.totals.perfectDays, label: t("reports.perfectDays") },
    { icon: <Trophy className="size-4 text-gold" />, value: stats.bestDayScore, label: t("reports.bestDay") },
  ];

  return (
    <section className="card p-3">
      <h2 className="mb-2 text-[13px] font-bold text-ink-dim">{t("reports.lifetime")}</h2>
      <div className="grid grid-cols-4 divide-x divide-border-soft/40 text-center [direction:ltr]">
        {tiles.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-0.5 [direction:rtl]">
            {s.icon}
            <span className="tnum text-lg font-extrabold text-ink">{s.value}</span>
            <span className="text-[10px] text-ink-faint">{s.label}</span>
          </div>
        ))}
      </div>
      {stats.bestDayKey !== null && (
        <p className="mt-2 border-t border-border-soft/40 pt-2 text-center text-[11px] text-ink-dim">
          {t("stats.best")}{" "}
          <span className="tnum text-ink">{formatBestDay(stats.bestDayKey)}</span>
        </p>
      )}
    </section>
  );
}
