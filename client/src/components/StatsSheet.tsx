// The worship record sheet (opened from the score pill): today's ring out of
// the 29-point perfect day, streak + best day, per-category progress for
// today, and the last-7-days chart (today highlighted gold). Everything is
// derived live by worship-stats — nothing here is stored.

import { Flame, Trophy } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  ADHKAR_SLOTS,
  FARD_POINTS,
  PERFECT_DAY_SCORE,
  RAWATIB_SLOTS,
  type DayLog,
} from "@/lib/worship-log";
import type { WorshipStats } from "@/lib/worship-stats";

interface StatsSheetProps {
  open: boolean;
  onClose: () => void;
  stats: WorshipStats;
  today: DayLog;
}

/** Arabic day letters keyed by getUTCDay() (Sun..Sat). */
const DAY_LETTERS = ["أ", "ن", "ث", "ر", "خ", "ج", "س"];

const dayLetter = (dayKey: string): string =>
  DAY_LETTERS[new Date(`${dayKey}T00:00:00Z`).getUTCDay()] ?? "";

export function StatsSheet({ open, onClose, stats, today }: StatsSheetProps) {
  const { t } = useI18n();

  const fardPts = Object.values(today.fard).reduce((s, st) => s + FARD_POINTS[st], 0);
  const rawatibDone = RAWATIB_SLOTS.filter((s) => today.rawatib[s]).length;
  const adhkarDone = ADHKAR_SLOTS.filter((s) => today.adhkar[s]).length;
  const duhaQiyam = (today.duha ? 1 : 0) + (today.qiyam ? 1 : 0);

  const breakdown = [
    { label: t("stats.fard"), got: fardPts, max: 15, color: "var(--color-gold)" },
    { label: t("stats.rawatib"), got: rawatibDone, max: RAWATIB_SLOTS.length, color: "var(--color-sky)" },
    { label: t("stats.adhkar"), got: adhkarDone, max: ADHKAR_SLOTS.length, color: "var(--color-teal)" },
    { label: t("stats.duhaQiyam"), got: duhaQiyam, max: 2, color: "var(--color-amber)" },
  ];

  const maxWeek = Math.max(1, ...stats.last7.map((d) => d.score));

  return (
    <BottomSheet open={open} onClose={onClose} title={t("stats.title")}>
      <div className="mb-4 flex items-center justify-around">
        <ProgressRing
          progress={Math.max(0, stats.todayScore) / PERFECT_DAY_SCORE}
          size={104}
          stroke={8}
          color="var(--color-gold)"
        >
          <span className="flex flex-col items-center leading-none">
            <span className="tnum text-3xl font-extrabold text-gold">{stats.todayScore}</span>
            <span className="tnum text-[11px] text-ink-dim">{t("stats.of", { n: String(PERFECT_DAY_SCORE) })}</span>
          </span>
        </ProgressRing>
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-sm font-bold text-urgent">
            <Flame className="size-4" />
            {t("stats.streakDays", { n: String(stats.streak) })}
          </span>
          <span className="flex items-center gap-1.5 text-sm font-bold text-ink-dim">
            <Trophy className="size-4 text-gold" />
            {t("stats.best")} <span className="tnum text-ink">{stats.bestDayScore}</span>
          </span>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2">
        {breakdown.map((b) => (
          <div key={b.label} className="flex items-center gap-2 text-[12px] font-semibold leading-none">
            <span className="w-24 shrink-0 text-ink-dim">{b.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(1, b.got / b.max)) * 100}%`,
                  background: b.color,
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <span className="tnum w-9 text-end" style={{ color: b.color }}>
              {b.got}/{b.max}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-end justify-between gap-1.5 px-1" style={{ height: 76 }}>
        {stats.last7.map((d, i) => {
          const isToday = i === stats.last7.length - 1;
          return (
            <div key={d.dayKey} className="flex flex-1 flex-col items-center gap-1 self-end">
              <div
                className={cn("w-full rounded-t", isToday ? "bg-gold" : "bg-teal/40")}
                style={{ height: Math.max(4, (Math.max(0, d.score) / maxWeek) * 54) }}
              />
              <span className={cn("text-[10px] leading-none", isToday ? "font-bold text-gold" : "text-ink-faint")}>
                {isToday ? t("stats.today") : dayLetter(d.dayKey)}
              </span>
            </div>
          );
        })}
      </div>

    </BottomSheet>
  );
}
