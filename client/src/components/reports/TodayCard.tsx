// Reports · today card — today's ring out of the 29-point perfect day plus a
// progress row per enabled worship category with its completion streak.
// Layout follows the approved ?design=9 mock; the row math came verbatim from
// the retired StatsSheet. Disabled categories are OMITTED, never zeroed
// (docs/V2_REDESIGN_SPEC.md Phase 6): fard is always on (record implies it),
// rawatib/adhkar follow their flags, the sunan row needs duha OR qiyam.

import { Flame } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useI18n } from "@/i18n/I18nProvider";
import type { WorshipFeatures } from "@/lib/storage";
import {
  ADHKAR_SLOTS,
  FARD_POINTS,
  PERFECT_DAY_SCORE,
  RAWATIB_SLOTS,
  type DayLog,
} from "@/lib/worship-log";
import type { WorshipStats } from "@/lib/worship-stats";

interface TodayCardProps {
  stats: WorshipStats;
  today: DayLog;
  features: WorshipFeatures;
}

interface CategoryRow {
  label: string;
  got: number;
  max: number;
  color: string;
  streak: number;
}

export function TodayCard({ stats, today, features }: TodayCardProps) {
  const { t } = useI18n();

  const fardPts = Object.values(today.fard).reduce((s, st) => s + FARD_POINTS[st], 0);
  const rawatibDone = RAWATIB_SLOTS.filter((s) => today.rawatib[s]).length;
  const adhkarDone = ADHKAR_SLOTS.filter((s) => today.adhkar[s]).length;
  const duhaQiyam = (today.duha ? 1 : 0) + (today.qiyam ? 1 : 0);

  const rows: CategoryRow[] = [
    { label: t("stats.fard"), got: fardPts, max: 15, color: "var(--color-gold)", streak: stats.streaks.fard },
    ...(features.rawatib
      ? [{ label: t("stats.rawatib"), got: rawatibDone, max: RAWATIB_SLOTS.length, color: "var(--color-sky)", streak: stats.streaks.rawatib }]
      : []),
    ...(features.adhkar
      ? [{ label: t("stats.adhkar"), got: adhkarDone, max: ADHKAR_SLOTS.length, color: "var(--color-teal)", streak: stats.streaks.adhkar }]
      : []),
    ...(features.duha || features.qiyam
      ? [{ label: t("stats.duhaQiyam"), got: duhaQiyam, max: 2, color: "var(--color-amber)", streak: stats.streaks.sunan }]
      : []),
  ];

  return (
    <section className="card flex items-center gap-4 p-4">
      <ProgressRing
        progress={Math.max(0, stats.todayScore) / PERFECT_DAY_SCORE}
        size={92}
        stroke={8}
        color="var(--color-gold)"
      >
        <span className="flex flex-col items-center leading-none">
          <span className="tnum text-2xl font-extrabold text-ink">{stats.todayScore}</span>
          <span className="tnum text-[11px] text-ink-faint" dir="ltr">
            /{PERFECT_DAY_SCORE}
          </span>
        </span>
      </ProgressRing>
      <div className="flex flex-1 flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 leading-none">
            <span className="w-24 shrink-0 text-[12px] font-semibold text-ink-dim">{r.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-veil/[0.08]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(1, r.got / r.max)) * 100}%`,
                  background: r.color,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <span className="tnum text-[11px] font-bold text-ink-dim">
              {r.got}/{r.max}
            </span>
            <span
              className="flex items-center gap-0.5 text-[11px] text-urgent"
              aria-label={t("stats.streakDays", { n: String(r.streak) })}
            >
              <Flame className="size-3" />
              <span className="tnum">{r.streak}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
