// المواقيت tab (docs/V2_REDESIGN_SPEC.md Phase 5): today's full prayer list
// (with check-ins — moved here from Home) + the monthly table with month
// navigation. Month data loads lazily on first visit (web endpoint / native
// offline engine) and is cached per (location, month) for the session.

import { useI18n } from "@/i18n/I18nProvider";
import { PrayerStrip } from "@/components/PrayerStrip";
import { MonthNav } from "@/components/times/MonthNav";
import { MonthTable } from "@/components/times/MonthTable";
import { useMonthTimes } from "@/hooks/useMonthTimes";
import { LoadingState } from "@/components/StatusViews";
import { localDayKey } from "@/lib/civil-day";
import type { CardCheckin } from "@/components/CheckinControl";
import type { useLocation } from "@/hooks/useLocation";
import type { usePrayerTimes } from "@/hooks/usePrayerTimes";
import type { UseSettings } from "@/hooks/useSettings";
import type { PrayerName } from "@/types/api";

interface TimesPageProps {
  location: ReturnType<typeof useLocation>;
  times: ReturnType<typeof usePrayerTimes>;
  settings: UseSettings;
  checkinFor: (name: PrayerName) => CardCheckin | null;
  isFriday: boolean;
  /** Tab visibility (pages are keep-mounted) — gates the lazy month load. */
  active: boolean;
}

export function TimesPage({ location, times, settings, checkinFor, isFriday, active }: TimesPageProps) {
  const { t, lang } = useI18n();
  const month = useMonthTimes({
    location: location.location,
    lang,
    method: settings.method,
    methodAuto: settings.methodAuto,
    asr: settings.asr,
    active,
  });

  if (!times.data) return null;
  const todayKey = location.location ? localDayKey(location.location.tz, times.now) : "";

  return (
    <>
      <h2 className="text-[13px] font-bold text-ink-dim">{t("times.todayTitle")}</h2>
      {/* Compact 3×2 strip (like Home) with embedded check-ins — the 6-row
          list ate too much vertical space above the month table (user). */}
      <PrayerStrip prayers={times.prayers} isFriday={isFriday} checkinFor={checkinFor} />

      <div className="mt-1 flex flex-col gap-2">
        <h2 className="text-[13px] font-bold text-ink-dim">{t("times.monthTitle")}</h2>
        <MonthNav
          monthKey={month.monthKey}
          data={month.data}
          isCurrentMonth={month.isCurrentMonth}
          onPrev={month.prevMonth}
          onNext={month.nextMonth}
          onReset={month.resetMonth}
        />
      </div>

      {month.data ? (
        <MonthTable days={month.data.days} todayKey={todayKey} />
      ) : month.loading ? (
        <LoadingState />
      ) : month.error ? (
        <p className="text-center text-sm text-imminent/80">{month.error}</p>
      ) : null}
    </>
  );
}
