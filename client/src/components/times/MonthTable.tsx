// Monthly prayer-times table (docs/V2_REDESIGN_SPEC.md Phase 5, user-approved
// mock). Display-only rows from /api/prayer-times/month (web) or the offline
// engine (native). Today's row is highlighted gold, Fridays tinted; numerals
// Latin per the product rule; sticky header for long scrolls.

import { useI18n } from "@/i18n/I18nProvider";
import { localizeTimeString } from "@/lib/format";
import { prayerNameKey } from "@/lib/prayer-names";
import { cn } from "@/lib/utils";
import type { MonthDayRow, PrayerName } from "@/types/api";

const TIME_COLS: PrayerName[] = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];

interface MonthTableProps {
  days: MonthDayRow[];
  /** Local civil day (YYYY-MM-DD) in the location tz — highlights the row. */
  todayKey: string;
}

/** "3:35 ص" → "3:35" — the table is too dense for day-period markers. */
function compact(time: string): string {
  return time.replace(/\s*(ص|م|AM|PM)$/i, "");
}

export function MonthTable({ days, todayKey }: MonthTableProps) {
  const { t, lang } = useI18n();

  return (
    <section className="card overflow-hidden">
      <div className="max-h-[60dvh] overflow-y-auto overscroll-contain">
        <table className="w-full text-center text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-ink-dim">
              <th className="border-b border-border-soft/60 px-1 py-2 font-semibold">
                {t("times.dayCol")}
              </th>
              <th className="border-b border-border-soft/60 px-1 py-2 font-semibold">
                {t("times.hijriCol")}
              </th>
              {TIME_COLS.map((name) => (
                <th key={name} className="border-b border-border-soft/60 px-1 py-2 font-semibold">
                  {t(prayerNameKey(name, false))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tnum">
            {days.map((row) => {
              const isToday = row.date === todayKey;
              return (
                <tr
                  key={row.date}
                  className={cn(
                    isToday
                      ? "bg-gold/15 font-bold text-gold"
                      : row.isFriday
                        ? "bg-veil/[0.04] text-teal"
                        : "text-ink-dim",
                  )}
                >
                  <td className="px-1 py-1.5 font-bold">{Number(row.date.slice(8))}</td>
                  <td className="px-1 py-1.5">{row.hijriDay}</td>
                  {TIME_COLS.map((name) => (
                    <td key={name} className="px-1 py-1.5">
                      {compact(localizeTimeString(row.times[name], lang))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
