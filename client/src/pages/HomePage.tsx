// Home tab (v2 shell — docs/V2_REDESIGN_SPEC.md Phase 3): the hero clock
// screen. JSX moved verbatim from App.tsx's old `mainContent` + TopBar; no
// visual changes in this phase (Phase 4 re-tunes the budget + swaps the list
// for the horizontal strip).

import { useMemo } from "react";
import { TopBar } from "@/components/TopBar";
import { NextPrayerCountdown, type HeroWorship } from "@/components/NextPrayerCountdown";
import { PrayerStrip } from "@/components/PrayerStrip";
import { NextEvent } from "@/components/NextEvent";
import {
  FetchErrorState,
  LoadingState,
  LocationNeededState,
} from "@/components/StatusViews";
import type { useLocation } from "@/hooks/useLocation";
import type { usePrayerTimes } from "@/hooks/usePrayerTimes";
import type { IqamaMinutes, WorshipFeatures } from "@/lib/storage";

interface HomePageProps {
  location: ReturnType<typeof useLocation>;
  times: ReturnType<typeof usePrayerTimes>;
  iqamaMinutes: IqamaMinutes;
  features: WorshipFeatures;
  heroWorship: HeroWorship | null;
  isFriday: boolean;
  showLocationNeeded: boolean;
  onOpenSearch: () => void;
}

export function HomePage({
  location,
  times,
  iqamaMinutes,
  features,
  heroWorship,
  isFriday,
  showLocationNeeded,
  onOpenSearch,
}: HomePageProps) {
  const mainContent = useMemo(() => {
    if (showLocationNeeded) {
      return (
        <LocationNeededState
          denied={location.status === "denied"}
          onUseGps={() => void location.requestGps()}
          onSearch={onOpenSearch}
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
        <NextPrayerCountdown
          next={times.next}
          now={times.now}
          duhaWindow={times.data.duhaWindow}
          qiyamWindow={times.data.qiyamWindow}
          prayers={times.prayers}
          iqamaMinutes={iqamaMinutes}
          worship={heroWorship}
          features={features}
          isFriday={isFriday}
        />
        {/* Glanceable strip — the full list (with check-ins) is on المواقيت. */}
        <PrayerStrip prayers={times.prayers} isFriday={isFriday} />
        {times.data.nextEvent && (
          <section className="card p-2.5">
            <NextEvent
              event={times.data.nextEvent}
              now={times.now}
              tz={location.location?.tz}
            />
          </section>
        )}
        {times.error && (
          <p className="text-center text-sm text-imminent/80">{times.error}</p>
        )}
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLocationNeeded, times.data, times.loading, times.error, times.next, times.prayers, times.now, location.status, iqamaMinutes, features, heroWorship, isFriday]);

  return (
    <>
      <TopBar
        location={location.location}
        data={times.data}
        now={times.now}
        resolving={location.resolving}
        onOpenSearch={onOpenSearch}
      />
      {mainContent}
    </>
  );
}
