// المواقيت tab — restructured for the qibla + nearest-masjid feature pair
// (docs/QIBLA_MASJID_SPEC.md §7): today strip (kept) → qibla compass → nearest
// masjids → month table DEMOTED into a collapsed section («الجدول الشهري»,
// default closed — useMonthTimes is gated on section-open so no request fires
// while it's closed). The compass heading hook lives HERE so the qibla card and
// the masjid bearing arrows share one sensor stream; sensors stop whenever the
// tab is hidden (keep-mounted tabs).

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { PrayerStrip } from "@/components/PrayerStrip";
import { QiblaCompass } from "@/components/qibla/QiblaCompass";
import { NearestMasjids } from "@/components/masjid/NearestMasjids";
import { MonthNav } from "@/components/times/MonthNav";
import { MonthTable } from "@/components/times/MonthTable";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { useCompassHeading } from "@/hooks/useCompassHeading";
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
  /** Tab visibility (pages are keep-mounted) — gates sensors + lazy loads. */
  active: boolean;
}

export function TimesPage({ location, times, settings, checkinFor, isFriday, active }: TimesPageProps) {
  const { t, lang } = useI18n();
  const [monthOpen, setMonthOpen] = useState(false);

  const loc = location.location;
  const compass = useCompassHeading(
    loc ? { lat: loc.lat, lon: loc.lon, elevation: loc.elevation } : null,
  );
  const { stop: stopCompass } = compass;

  // Keep-mounted tabs: sensors must not run while the user sits on another tab.
  useEffect(() => {
    if (!active) stopCompass();
  }, [active, stopCompass]);

  const month = useMonthTimes({
    location: loc,
    lang,
    method: settings.method,
    methodAuto: settings.methodAuto,
    asr: settings.asr,
    // The collapsed month section defers its (web) request / (native) compute
    // until the user actually opens it.
    active: active && monthOpen,
  });

  if (!times.data) return null;
  const todayKey = loc ? localDayKey(loc.tz, times.now) : "";

  return (
    <>
      <h2 className="text-[13px] font-bold text-ink-dim">{t("times.todayTitle")}</h2>
      {/* Compact 3×2 strip (like Home) with embedded check-ins — the 6-row
          list ate too much vertical space above the month table (user). */}
      <PrayerStrip prayers={times.prayers} isFriday={isFriday} checkinFor={checkinFor} />

      {loc && (
        <>
          <QiblaCompass location={loc} compass={compass} />
          <NearestMasjids
            location={loc}
            active={active}
            compass={compass}
            onUseGps={() =>
              void location.requestGps({ enableHighAccuracy: true, maximumAge: 0 })
            }
            resolving={location.resolving}
          />
        </>
      )}

      <CollapsibleSection
        icon={<CalendarDays className="size-5" />}
        iconClass="bg-teal/10 text-teal"
        title={t("times.monthTitle")}
        open={monthOpen}
        onToggle={setMonthOpen}
      >
        <div className="flex flex-col gap-2">
          <MonthNav
            monthKey={month.monthKey}
            data={month.data}
            isCurrentMonth={month.isCurrentMonth}
            onPrev={month.prevMonth}
            onNext={month.nextMonth}
            onReset={month.resetMonth}
          />
          {month.data ? (
            <MonthTable days={month.data.days} todayKey={todayKey} />
          ) : month.loading ? (
            <LoadingState />
          ) : month.error ? (
            <p className="text-center text-sm text-imminent/80">{month.error}</p>
          ) : null}
        </div>
      </CollapsibleSection>
    </>
  );
}
