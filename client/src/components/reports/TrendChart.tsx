// Reports · trend chart — the switchable أسبوع/شهر/أشهر history bars. The Bar
// column and day-letter labels moved verbatim from the retired StatsSheet; the
// header chrome (title + gold chip switcher) follows the approved ?design=9 mock.

import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { WorshipStats } from "@/lib/worship-stats";
import type { StringKey } from "@/i18n/strings.en";

type TrendView = "week" | "month" | "months";

/** Arabic day letters keyed by getUTCDay() (Sun..Sat). */
const DAY_LETTERS = ["أ", "ن", "ث", "ر", "خ", "ج", "س"];

const dayLetter = (dayKey: string): string =>
  DAY_LETTERS[new Date(`${dayKey}T00:00:00Z`).getUTCDay()] ?? "";

/** One vertical bar column with a fixed-height label slot (keeps bars aligned). */
function Bar({
  fraction,
  highlight,
  label,
}: {
  fraction: number;
  highlight: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 self-end">
      <div
        className={cn("w-full rounded-t", highlight ? "bg-gold" : "bg-teal/40")}
        style={{ height: Math.max(3, Math.max(0, fraction) * 54) }}
      />
      <span
        className={cn(
          "tnum h-3 text-[9px] leading-none",
          highlight ? "font-bold text-gold" : "text-ink-faint",
        )}
      >
        {label}
      </span>
    </div>
  );
}

interface TrendChartProps {
  stats: WorshipStats;
}

export function TrendChart({ stats }: TrendChartProps) {
  const { t } = useI18n();
  const [view, setView] = useState<TrendView>("week");

  const maxWeek = Math.max(1, ...stats.last7.map((d) => d.score));
  const maxMonth = Math.max(1, ...stats.last30.map((d) => d.score));
  const maxMonths = Math.max(1, ...stats.monthly.map((m) => m.points));

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-bold text-ink-dim">{t("reports.trendTitle")}</h2>
        <div className="flex gap-1">
          {(["week", "month", "months"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                view === v ? "bg-gold/15 text-gold" : "bg-veil/[0.04] text-ink-faint hover:text-ink",
              )}
            >
              {t(`stats.${v}` as StringKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end justify-between gap-[3px] px-1" style={{ height: 76 }}>
        {view === "week" &&
          stats.last7.map((d, i) => {
            const isToday = i === stats.last7.length - 1;
            return (
              <Bar
                key={d.dayKey}
                fraction={d.score / maxWeek}
                highlight={isToday}
                label={isToday ? t("stats.today") : dayLetter(d.dayKey)}
              />
            );
          })}
        {view === "month" &&
          stats.last30.map((d, i) => {
            const isToday = i === stats.last30.length - 1;
            const showLabel = isToday || i % 5 === 0;
            return (
              <Bar
                key={d.dayKey}
                fraction={d.score / maxMonth}
                highlight={isToday}
                label={showLabel ? String(Number(d.dayKey.slice(8, 10))) : ""}
              />
            );
          })}
        {view === "months" &&
          stats.monthly.map((m, i) => {
            const isCurrent = i === stats.monthly.length - 1;
            return (
              <Bar
                key={m.monthKey}
                fraction={m.points / maxMonths}
                highlight={isCurrent}
                label={String(Number(m.monthKey.slice(5, 7)))}
              />
            );
          })}
      </div>
    </section>
  );
}
