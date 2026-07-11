// Root app: composes the location bar, hero countdown, prayer list, hijri +
// event row, and the slide-over panels. Wires the live-countdown hook to the
// resolved location + settings, degrading gracefully at every step. Also owns
// the worship tracker: useWorshipLog + the four bottom sheets (rawatib,
// adhkar checklist, tap-to-count reader, stats).

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocation } from "@/hooks/useLocation";
import { useSettings } from "@/hooks/useSettings";
import { usePrayerTimes } from "@/hooks/usePrayerTimes";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { useLocalAlerts } from "@/hooks/useLocalAlerts";
import { useNativeAlarmScheduler } from "@/hooks/useNativeAlarmScheduler";
import { useAndroidBack } from "@/hooks/useAndroidBack";
import { useFirstRunPermissions } from "@/hooks/useFirstRunPermissions";
import { isNative } from "@/lib/native";
import { seedDefaultLocalAlerts } from "@/lib/local-alerts-store";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useWorshipLog } from "@/hooks/useWorshipLog";
import { useAlarm } from "@/hooks/useAlarm";
import { unlockAlarmAudio } from "@/lib/alarm-sound";
import { glowBreathPeriod } from "@/lib/format";
import { isFridayKey } from "@/lib/prayer-names";
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
import { AlarmOverlay } from "@/components/AlarmOverlay";
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
  const alarm = useAlarm(); // full-screen alarm when an alarm-kind reminder fires

  // Unlock alarm audio on the first user interaction so a later push-triggered
  // alarm (while the app is open) can play without its own gesture — browsers
  // block audio until the page has been interacted with at least once.
  useEffect(() => {
    const unlock = () => {
      unlockAlarmAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sheet, setSheet] = useState<WorshipSheet>(null);

  // Native only: seed the default reminder once at mount so a fresh user gets a
  // reminder without opening Settings first (no-op on web / after first seed).
  useEffect(() => {
    if (isNative()) seedDefaultLocalAlerts();
  }, []);

  // Native only: first launch asks for the alarm permissions right away
  // (notification dialog + the top missing system screen). One-time.
  useFirstRunPermissions();

  // Android hardware back: close the top-most overlay, else minimize the app.
  useAndroidBack(() => {
    if (alarm.alarm) {
      alarm.dismiss();
      return true;
    }
    if (sheet !== null) {
      setSheet(null);
      return true;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (searchOpen) {
      setSearchOpen(false);
      return true;
    }
    return false;
  });

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

  // On Fridays the ظهر congregation is Jumu'ah — the label swaps to الجمعة
  // everywhere a today prayer name is shown. Keyed on the location-tz civil day
  // so it flips at local midnight.
  const isFriday = isFridayKey(worship.todayKey);

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

  // Native (Capacitor) app only: keep OS-level alarms in sync with device-local
  // reminder rules. No-op on web (guarded inside the hooks by isNative()).
  const localAlerts = useLocalAlerts();
  useNativeAlarmScheduler({
    location: location.location,
    lang,
    method: settings.method,
    methodAuto: settings.methodAuto,
    asr: settings.asr,
    toneId: settings.alarmSound,
    rules: localAlerts.rules,
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
        streak: worship.stats.streaks.fard,
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
  // Gated by the opt-in "record" feature — off by default.
  const recordOn = settings.features.record;
  const checkinFor = useMemo(
    () =>
      (name: PrayerName): CardCheckin | null => {
        if (!recordOn || name === "sunrise") return null;
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
    [worship, recordOn],
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
          features={settings.features}
          isFriday={isFriday}
        />
        <PrayerList prayers={times.prayers} now={times.now} checkinFor={checkinFor} isFriday={isFriday} />
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
  }, [showLocationNeeded, times.data, times.loading, times.error, times.next, times.prayers, times.now, location.status, settings.iqamaMinutes, settings.features, heroWorship, checkinFor, isFriday]);

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
        features={settings.features}
        onChangeFeature={settings.setFeature}
        alarmSound={settings.alarmSound}
        onChangeAlarmSound={settings.setAlarmSound}
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
        mark={worship.mark}
        isFriday={isFriday}
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
          isFriday={isFriday}
        />
      )}
      <StatsSheet
        open={sheet === "stats"}
        onClose={() => setSheet(null)}
        stats={worship.stats}
        today={worship.today}
      />

      {alarm.alarm && (
        <AlarmOverlay
          title={alarm.alarm.title}
          body={alarm.alarm.body}
          onStop={alarm.dismiss}
        />
      )}
    </div>
  );
}

export default App;
