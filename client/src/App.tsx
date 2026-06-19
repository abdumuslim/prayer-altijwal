// Root app: composes the location bar, hero countdown, prayer list, hijri +
// event row, and the slide-over panels. Wires the live-countdown hook to the
// resolved location + settings, degrading gracefully at every step.

import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocation } from "@/hooks/useLocation";
import { useSettings } from "@/hooks/useSettings";
import { usePrayerTimes } from "@/hooks/usePrayerTimes";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { LocationBar } from "@/components/LocationBar";
import { NextPrayerCountdown } from "@/components/NextPrayerCountdown";
import { PrayerList } from "@/components/PrayerList";
import { HijriDate } from "@/components/HijriDate";
import { NextEvent } from "@/components/NextEvent";
import { CitySearch } from "@/components/CitySearch";
import { SettingsPanel } from "@/components/SettingsPanel";
import {
  FetchErrorState,
  LoadingState,
  LocationNeededState,
} from "@/components/StatusViews";
import type { AsrMadhab } from "@/types/api";

function App() {
  const { t } = useI18n();
  const { lang } = useI18n();
  const location = useLocation();
  const settings = useSettings();
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const times = usePrayerTimes({
    location: location.location,
    method: settings.method,
    methodAuto: settings.methodAuto,
    asr: settings.asr,
    lang,
  });

  // Effective method/asr for the push payload (prefer the server's resolved
  // values, fall back to user settings).
  const effectiveMethod =
    times.data?.method.key ?? settings.method ?? "MWL";
  const effectiveAsr: AsrMadhab =
    times.data?.method.asr ?? settings.asr ?? "Standard";

  const push = usePushSubscription({
    location: location.location,
    method: effectiveMethod,
    asr: effectiveAsr,
    lang,
  });

  const methodInfo = times.data?.method ?? null;

  const showLocationNeeded =
    !location.location &&
    (location.status === "denied" || location.status === "error");

  const mainContent = useMemo(() => {
    if (showLocationNeeded) {
      return (
        <LocationNeededState
          denied={location.status === "denied"}
          onUseGps={() => void location.requestGps()}
          onSearch={() => setSearchOpen(true)}
        />
      );
    }
    if (!times.data && times.loading) return <LoadingState />;
    if (!times.data && times.error) {
      return <FetchErrorState message={times.error} onRetry={times.refetch} />;
    }
    if (!times.data) return <LoadingState />;

    return (
      <>
        <NextPrayerCountdown next={times.next} now={times.now} />
        <PrayerList prayers={times.prayers} now={times.now} />
        <section className="card flex flex-col gap-3 p-4">
          <HijriDate data={times.data} />
          {times.data.nextEvent && (
            <>
              <div className="h-px bg-border-soft/60" />
              <NextEvent event={times.data.nextEvent} />
            </>
          )}
        </section>
        {times.error && (
          <p className="text-center text-xs text-imminent/80">{times.error}</p>
        )}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLocationNeeded, times.data, times.loading, times.error, times.next, times.prayers, times.now, location.status]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-4 pb-10 pt-5 sm:pt-7">
      <LocationBar
        location={location.location}
        method={methodInfo}
        resolving={location.resolving}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onUseGps={() => void location.requestGps()}
      />

      {mainContent}

      <footer className="mt-auto pt-2 text-center text-[11px] text-ink-faint">
        {t("common.credit")}
      </footer>

      <CitySearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(loc) => location.setLocation(loc)}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        resolvedMethod={methodInfo}
        methodAuto={settings.methodAuto}
        effectiveAsr={effectiveAsr}
        onSelectMethod={settings.setMethod}
        onResetAuto={settings.resetMethodToAuto}
        onSelectAsr={settings.setAsr}
        push={push}
      />
    </div>
  );
}

export default App;
