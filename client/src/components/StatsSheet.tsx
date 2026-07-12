// The worship record sheet (opened from the score pill): today's ring out of
// the 29-point perfect day, best day, per-category progress for today with each
// section's completion streak, and a switchable history chart (week / month /
// months). Everything is derived live by worship-stats — nothing here is stored.

import { useState } from "react";
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
import type { StringKey } from "@/i18n/strings.en";

interface StatsSheetProps {
  open: boolean;
  onClose: () => void;
  stats: WorshipStats;
  today: DayLog;
}

type HistoryView = "week" | "month" | "months";

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

export function StatsSheet({ open, onClose, stats, today }: StatsSheetProps) {
  const { t } = useI18n();
  const [view, setView] = useState<HistoryView>("week");

  const fardPts = Object.values(today.fard).reduce((s, st) => s + FARD_POINTS[st], 0);
  const rawatibDone = RAWATIB_SLOTS.filter((s) => today.rawatib[s]).length;
  const adhkarDone = ADHKAR_SLOTS.filter((s) => today.adhkar[s]).length;
  const duhaQiyam = (today.duha ? 1 : 0) + (today.qiyam ? 1 : 0);

  const breakdown = [
    { label: t("stats.fard"), got: fardPts, max: 15, color: "var(--color-gold)", streak: stats.streaks.fard },
    { label: t("stats.rawatib"), got: rawatibDone, max: RAWATIB_SLOTS.length, color: "var(--color-sky)", streak: stats.streaks.rawatib },
    { label: t("stats.adhkar"), got: adhkarDone, max: ADHKAR_SLOTS.length, color: "var(--color-teal)", streak: stats.streaks.adhkar },
    { label: t("stats.duhaQiyam"), got: duhaQiyam, max: 2, color: "var(--color-amber)", streak: stats.streaks.sunan },
  ];

  const maxWeek = Math.max(1, ...stats.last7.map((d) => d.score));
  const maxMonth = Math.max(1, ...stats.last30.map((d) => d.score));
  const maxMonths = Math.max(1, ...stats.monthly.map((m) => m.points));

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
            {t("stats.streakDays", { n: String(stats.streaks.fard) })}
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
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-veil/[0.08]">
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
            <span
              className="tnum flex w-8 shrink-0 items-center justify-end gap-0.5 text-urgent"
              aria-label={b.streak > 0 ? t("stats.streakDays", { n: String(b.streak) }) : undefined}
            >
              {b.streak > 0 ? (
                <>
                  <Flame className="size-3" />
                  {b.streak}
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>

      {/* History view switcher */}
      <div className="mb-3 flex justify-center gap-1.5">
        {(["week", "month", "months"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "rounded-full border px-3.5 py-1 text-[11px] font-semibold transition-colors",
              view === v
                ? "border-teal/50 bg-teal/10 text-teal"
                : "border-border-soft/60 bg-veil/[0.02] text-ink-dim hover:text-ink",
            )}
          >
            {t(`stats.${v}` as StringKey)}
          </button>
        ))}
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
    </BottomSheet>
  );
}
