// Root app: composes the location bar, hero countdown, prayer list, hijri +
// event row, and the slide-over panels. Wires the live-countdown hook to the
// resolved location + settings, degrading gracefully at every step.

import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocation } from "@/hooks/useLocation";
import { useSettings } from "@/hooks/useSettings";
import { usePrayerTimes } from "@/hooks/usePrayerTimes";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { TopBar } from "@/components/TopBar";
import { NextPrayerCountdown } from "@/components/NextPrayerCountdown";
import { PrayerList } from "@/components/PrayerList";
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
        {times.data.nextEvent && (
          <section className="card p-3">
            <NextEvent
              event={times.data.nextEvent}
              now={times.now}
              tz={location.location?.tz}
            />
          </section>
        )}
        {times.error && (
          <p className="text-center text-xs text-imminent/80">{times.error}</p>
        )}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLocationNeeded, times.data, times.loading, times.error, times.next, times.prayers, times.now, location.status]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-3 px-4 pb-4 pt-3">
      <TopBar
        location={location.location}
        data={times.data}
        now={times.now}
        resolving={location.resolving}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />

      {mainContent}

      <CitySearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(loc) => location.setLocation(loc)}
        country={location.location?.country ?? null}
        onUseGps={() => void location.requestGps()}
        resolving={location.resolving}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        push={push}
      />
    </div>
  );
}

export default App;
