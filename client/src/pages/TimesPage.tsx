// المواقيت tab — restructured for the qibla + nearest-masjid feature pair
// (docs/QIBLA_MASJID_SPEC.md §7): qibla compass → nearest masjids → month table
// in a collapsible section («الجدول الشهري», OPEN by default since 2026-07-19 —
// useMonthTimes stays gated on `active && monthOpen` so nothing fires off-tab).
// The today prayer strip was removed (duplicate of the Home strip — user,
// 2026-07-19); its per-prayer check-ins now live on the Home strip instead. The
// compass heading hook lives HERE so the qibla card and the masjid bearing
// arrows share one sensor stream; sensors stop whenever the tab is hidden
// (keep-mounted tabs).

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { QiblaCompass } from "@/components/qibla/QiblaCompass";
import { NearestMasjids } from "@/components/masjid/NearestMasjids";
import { MonthNav } from "@/components/times/MonthNav";
import { MonthTable } from "@/components/times/MonthTable";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { hasGeolocationPermission } from "@/lib/geolocation";
import { useCompassHeading } from "@/hooks/useCompassHeading";
import { useMonthTimes } from "@/hooks/useMonthTimes";
import { LoadingState } from "@/components/StatusViews";
import { localDayKey } from "@/lib/civil-day";
import type { useLocation } from "@/hooks/useLocation";
import type { usePrayerTimes } from "@/hooks/usePrayerTimes";
import type { UseSettings } from "@/hooks/useSettings";

interface TimesPageProps {
  location: ReturnType<typeof useLocation>;
  times: ReturnType<typeof usePrayerTimes>;
  settings: UseSettings;
  /** Tab visibility (pages are keep-mounted) — gates sensors + lazy loads. */
  active: boolean;
}

export function TimesPage({ location, times, settings, active }: TimesPageProps) {
  const { t, lang } = useI18n();
  // Month section OPEN by default (user, 2026-07-19 — was default-closed). The
  // `active && monthOpen` gate below still defers the month request/compute
  // until the Times tab is actually shown, so nothing fires from other tabs.
  const [monthOpen, setMonthOpen] = useState(true);

  const loc = location.location;
  const compass = useCompassHeading(
    loc ? { lat: loc.lat, lon: loc.lon, elevation: loc.elevation } : null,
  );
  const { stop: stopCompass, start: startCompass } = compass;

  // Keep-mounted tabs: sensors must not run while the user sits on another tab.
  useEffect(() => {
    if (!active) stopCompass();
  }, [active, stopCompass]);

  // Auto-start the compass whenever the Times tab is shown, EXCEPT on iOS-web
  // where the sensor permission needs an explicit button tap. Returning to the
  // tab re-fires (stop() reset status to "idle") → "starts by itself, never
  // asks" (docs/QIBLA_MASJID_SPEC.md — the user's one-time-permission request).
  useEffect(() => {
    if (active && loc && compass.status === "idle" && !compass.needsGesture) {
      void startCompass();
    }
  }, [active, loc, compass.status, compass.needsGesture, startCompass]);

  // Bumped by pull-to-refresh → NearestMasjids refetches.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { requestGpsStaged } = location;

  // A user who already granted location shouldn't have to press "use my
  // location" again on every visit — but permission is only CHECKED here, never
  // requested, so the opt-in stays opt-in for everyone else (spec Q5).
  const autoFixTriedRef = useRef(false);
  useEffect(() => {
    if (!active || autoFixTriedRef.current) return;
    if (loc?.source === "gps") return;
    autoFixTriedRef.current = true;
    void hasGeolocationPermission().then((granted) => {
      if (granted) void requestGpsStaged().catch(() => undefined);
    });
  }, [active, loc?.source, requestGpsStaged]);

  const onRefresh = useCallback(async () => {
    setRefreshNonce((n) => n + 1);
    await requestGpsStaged().catch(() => undefined);
  }, [requestGpsStaged]);

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
      <PullToRefresh onRefresh={onRefresh} enabled={active} />
      {loc && (
        <>
          <QiblaCompass location={loc} compass={compass} />
          <NearestMasjids
            location={loc}
            active={active}
            compass={compass}
            onUseGps={() => void requestGpsStaged().catch(() => undefined)}
            resolving={location.resolving}
            gpsErrorKind={location.errorKind}
            refreshNonce={refreshNonce}
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
