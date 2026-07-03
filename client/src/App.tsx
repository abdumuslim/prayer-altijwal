// Root app: composes the location bar, hero countdown, prayer list, hijri +
// event row, and the slide-over panels. Wires the live-countdown hook to the
// resolved location + settings, degrading gracefully at every step. Also owns
// the worship tracker: useWorshipLog + the four bottom sheets (rawatib,
// adhkar checklist, tap-to-count reader, stats).

import { useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocation } from "@/hooks/useLocation";
import { useSettings } from "@/hooks/useSettings";
import { usePrayerTimes } from "@/hooks/usePrayerTimes";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useWorshipLog } from "@/hooks/useWorshipLog";
import { glowBreathPeriod } from "@/lib/format";
import {
  deriveAdhkarCorner,
  deriveCheckinPrayer,
  deriveRawatibCorner,
} from "@/lib/worship-vm";
import { TopBar } from "@/components/TopBar";
import { NextPrayerCountdown, type HeroWorship } from "@/components/NextPrayerCountdown";
import { PrayerList } from "@/components/PrayerList";
import { NextEvent } from "@/components/NextEvent";
import { CitySearch } from "@/components/CitySearch";
import { SettingsPanel } from "@/components/SettingsPanel";
import { RawatibSheet } from "@/components/RawatibSheet";
import { AdhkarSheet } from "@/components/AdhkarSheet";
import { AdhkarReader } from "@/components/AdhkarReader";
import { StatsSheet } from "@/components/StatsSheet";
import {
  FetchErrorState,
  LoadingState,
  LocationNeededState,
} from "@/components/StatusViews";
import type { CardCheckin } from "@/components/PrayerCard";
import type { AdhkarSlot, FardPrayer } from "@/lib/worship-log";
import type { AsrMadhab, PrayerName } from "@/types/api";

const AFTER_SLOT: Record<FardPrayer, AdhkarSlot> = {
  fajr: "afterFajr",
  dhuhr: "afterDhuhr",
  asr: "afterAsr",
  maghrib: "afterMaghrib",
  isha: "afterIsha",
};

type WorshipSheet = null | "rawatib" | "adhkar" | "stats" | { reader: AdhkarSlot };

function App() {
  const { lang } = useI18n();
  const location = useLocation();
  const settings = useSettings();
  useWakeLock(); // keep the screen awake while the app is open
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheet, setSheet] = useState<WorshipSheet>(null);

  const times = usePrayerTimes({
    location: location.location,
    method: settings.method,
    methodAuto: settings.methodAuto,
    asr: settings.asr,
    lang,
  });

  const worship = useWorshipLog({
    tz: location.location?.tz ?? null,
    prayers: times.prayers,
    now: times.now,
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

  // The hero's worship view-model: corner rings, score pill, satellites'
  // done flags and the contextual check-in row.
  const heroWorship = useMemo((): HeroWorship | null => {
    if (!times.data) return null;
    const checkinPrayer = deriveCheckinPrayer(times.prayers, times.now);
    return {
      pill: {
        points: worship.stats.todayScore,
        streak: worship.stats.streak,
        onOpen: () => setSheet("stats"),
      },
      rawatib: {
        ...deriveRawatibCorner(worship.today, worship.canMark),
        onOpen: () => setSheet("rawatib"),
      },
      adhkar: {
        ...deriveAdhkarCorner(worship.today, worship.dhikrProgress, times.prayers, times.now),
        onOpen: () => setSheet("adhkar"),
      },
      duhaDone: worship.today.duha,
      qiyamDone: worship.today.qiyam,
      onToggleDuha: () => worship.mark({ kind: "duha", done: !worship.today.duha }),
      onToggleQiyam: () => worship.mark({ kind: "qiyam", done: !worship.today.qiyam }),
      checkin: checkinPrayer
        ? {
            prayer: checkinPrayer,
            state: worship.today.fard[checkinPrayer],
            adhkarDone: worship.today.adhkar[AFTER_SLOT[checkinPrayer]],
            onMark: (state) => worship.mark({ kind: "fard", prayer: checkinPrayer, state }),
            onOpenAdhkar: () => setSheet({ reader: AFTER_SLOT[checkinPrayer] }),
          }
        : null,
    };
  }, [times.data, times.prayers, times.now, worship]);

  // Per-card check-in control (fard only; icon appears once the adhan passes).
  const checkinFor = useMemo(
    () =>
      (name: PrayerName): CardCheckin | null => {
        if (name === "sunrise") return null;
        const prayer = name as FardPrayer;
        const enabled = worship.canMark({ kind: "fard", prayer, state: "masjid" });
        const state = worship.today.fard[prayer];
        if (state === "unmarked" && !enabled) return null;
        return {
          state,
          enabled,
          onMark: (s) => worship.mark({ kind: "fard", prayer, state: s }),
        };
      },
    [worship],
  );

  const readerSlot = typeof sheet === "object" && sheet !== null ? sheet.reader : null;

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
        <NextPrayerCountdown
          next={times.next}
          now={times.now}
          duhaWindow={times.data.duhaWindow}
          qiyamWindow={times.data.qiyamWindow}
          prayers={times.prayers}
          iqamaMinutes={settings.iqamaMinutes}
          worship={heroWorship}
        />
        <PrayerList prayers={times.prayers} now={times.now} checkinFor={checkinFor} />
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
  }, [showLocationNeeded, times.data, times.loading, times.error, times.next, times.prayers, times.now, location.status, settings.iqamaMinutes, heroWorship, checkinFor]);

  // One breath timeline for the whole screen: the period ramps with the next
  // prayer's countdown, and every breathing element (hero halo + next-prayer
  // card) inherits --glow-period / the animated --breath from this wrapper, so
  // they all breathe in perfect lockstep. No next prayer → calm slow breath.
  const breathPeriod = glowBreathPeriod(times.next?.msUntil ?? Number.POSITIVE_INFINITY);

  return (
    <div
      className="breath-driver mx-auto flex min-h-screen w-full max-w-xl flex-col gap-3 px-4 pb-2 pt-3"
      style={{ "--glow-period": `${breathPeriod.toFixed(2)}s` } as CSSProperties}
    >
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
        iqamaMinutes={settings.iqamaMinutes}
        onChangeIqama={settings.setIqama}
      />

      {/* Worship tracker sheets */}
      <RawatibSheet
        open={sheet === "rawatib"}
        onClose={() => setSheet(null)}
        today={worship.today}
        canMark={worship.canMark}
        mark={worship.mark}
      />
      <AdhkarSheet
        open={sheet === "adhkar"}
        onClose={() => setSheet(null)}
        today={worship.today}
        canMark={worship.canMark}
        onOpenReader={(slot) => setSheet({ reader: slot })}
      />
      {readerSlot && (
        <AdhkarReader
          open
          onClose={() => setSheet(null)}
          slot={readerSlot}
          counts={
            worship.dhikrProgress[readerSlot]?.dayKey === worship.todayKey
              ? worship.dhikrProgress[readerSlot]?.counts ?? []
              : []
          }
          onCount={(i, c) => worship.setDhikrCount(readerSlot, i, c)}
        />
      )}
      <StatsSheet
        open={sheet === "stats"}
        onClose={() => setSheet(null)}
        stats={worship.stats}
        today={worship.today}
      />
    </div>
  );
}

export default App;
