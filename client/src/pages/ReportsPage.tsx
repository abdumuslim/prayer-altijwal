// التقارير tab (v2 Phase 6 — docs/V2_REDESIGN_SPEC.md). Replaces the retired
// StatsSheet: today ring + category rows, trend chart, 62-day heatmap,
// per-prayer breakdown and lifetime totals, in the approved ?design=9 order.
// Renders a fragment — App.tsx's pageClass("reports", true) wrapper supplies
// flex/scroll/padding. With the record feature off, only an enable-CTA shows;
// disabled categories are omitted inside TodayCard (never zeroed).

import { ChartColumnBig } from "lucide-react";
import { HeatmapCalendar } from "@/components/reports/HeatmapCalendar";
import { LifetimeTotals } from "@/components/reports/LifetimeTotals";
import { PerPrayerBreakdown } from "@/components/reports/PerPrayerBreakdown";
import { TodayCard } from "@/components/reports/TodayCard";
import { TrendChart } from "@/components/reports/TrendChart";
import { useI18n } from "@/i18n/I18nProvider";
import type { WorshipFeatures } from "@/lib/storage";
import type { DayLog } from "@/lib/worship-log";
import type { WorshipStats } from "@/lib/worship-stats";

interface ReportsPageProps {
  stats: WorshipStats;
  today: DayLog;
  features: WorshipFeatures;
  onEnableRecord: () => void;
}

/** Empty state when the record feature is off (StatusViews idiom). */
function RecordOffState({ onEnable }: { onEnable: () => void }) {
  const { t } = useI18n();
  return (
    <div className="card flex min-h-[260px] flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-teal/10 text-teal">
        <ChartColumnBig className="size-6" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold text-ink">{t("reports.emptyTitle")}</h2>
        <p className="max-w-xs text-base text-ink-dim">{t("reports.emptyBody")}</p>
      </div>
      <button
        type="button"
        onClick={onEnable}
        className="rounded-xl bg-gradient-to-r from-emerald-deep to-emerald px-5 py-2.5 text-base font-semibold text-night-2 transition hover:brightness-110"
      >
        {t("reports.enableRecord")}
      </button>
    </div>
  );
}

export function ReportsPage({ stats, today, features, onEnableRecord }: ReportsPageProps) {
  if (!features.record) return <RecordOffState onEnable={onEnableRecord} />;

  return (
    <>
      <TodayCard stats={stats} today={today} features={features} />
      <TrendChart stats={stats} />
      <HeatmapCalendar days={stats.heatmap62} />
      <PerPrayerBreakdown perPrayer={stats.perPrayer62} />
      <LifetimeTotals stats={stats} />
    </>
  );
}
