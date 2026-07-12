// Reports · 62-day heatmap — weeks × 7 grid (column-major; RTL flows the
// columns newest-at-start), emerald intensity scaled by score/29, unlogged
// days a faint veil tint, today outlined gold. Markup from the approved
// ?design=9 mock; negative day scores clamp to the empty tone (an all-missed
// day must not render a ghost emerald).

import { useI18n } from "@/i18n/I18nProvider";
import { PERFECT_DAY_SCORE } from "@/lib/worship-log";
import type { DayScore } from "@/lib/worship-stats";

interface HeatmapCalendarProps {
  /** stats.heatmap62 — RETAIN_DAYS entries, oldest → newest (today last). */
  days: DayScore[];
}

export function HeatmapCalendar({ days }: HeatmapCalendarProps) {
  const { t } = useI18n();

  return (
    <section className="card p-4">
      <h2 className="mb-3 text-[13px] font-bold text-ink-dim">{t("reports.heatmapTitle")}</h2>
      <div className="grid grid-flow-col grid-rows-7 justify-center gap-[3px]">
        {days.map((d, i) => {
          const v = Math.max(0, d.score);
          return (
            <span
              key={d.dayKey}
              className="size-[13px] rounded-[3px]"
              style={{
                background:
                  v === 0
                    ? "color-mix(in srgb, var(--color-veil) 6%, transparent)"
                    : `color-mix(in srgb, var(--color-emerald) ${20 + (v / PERFECT_DAY_SCORE) * 80}%, transparent)`,
                outline: i === days.length - 1 ? "1.5px solid var(--color-gold)" : undefined,
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
