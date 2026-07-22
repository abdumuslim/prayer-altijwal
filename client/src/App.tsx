// v2 shell (docs/V2_REDESIGN_SPEC.md Phase 3): App owns the global hooks, the
// breath-driver root (the ONE persistent ancestor every breathing element
// inherits --breath from), the tab state, and the overlays (search, worship
// sheets, alarm). Page content lives in src/pages/*; all four pages stay MOUNTED
// inside the swipeable TabPager (inactive ones translated off-screen + inert) so
// the hero countdown interval and the breath timeline never reset on tab switches.

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
import { migrateRemoveSeededDefault } from "@/lib/local-alerts-store";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useWorshipLog } from "@/hooks/useWorshipLog";
import { useAlarm } from "@/hooks/useAlarm";
import { unlockAlarmAudio } from "@/lib/alarm-sound";
import { applyTheme } from "@/lib/theme";
import { glowBreathPeriod } from "@/lib/format";
import { isFridayKey } from "@/lib/prayer-names";
import {
  deriveAdhkarCorner,
  deriveCheckinPrayer,
  deriveRawatibCorner,
} from "@/lib/worship-vm";
import { TabBar, TAB_IDS, type TabId } from "@/components/shell/TabBar";
import { TabPager } from "@/components/shell/TabPager";
import { HomePage } from "@/pages/HomePage";
import { TimesPage } from "@/pages/TimesPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { CitySearch } from "@/components/CitySearch";
import { RawatibSheet } from "@/components/RawatibSheet";
import { AdhkarSheet } from "@/components/AdhkarSheet";
import { AdhkarReader } from "@/components/AdhkarReader";
import { AlarmOverlay } from "@/components/AlarmOverlay";
import type { HeroWorship } from "@/components/NextPrayerCountdown";
import type { CardCheckin } from "@/components/CheckinControl";
import type { AdhkarSlot, FardPrayer } from "@/lib/worship-log";
import type { AsrMadhab, PrayerName } from "@/types/api";

const AFTER_SLOT: Record<FardPrayer, AdhkarSlot> = {
  fajr: "afterFajr",
  dhuhr: "afterDhuhr",
  asr: "afterAsr",
  maghrib: "afterMaghrib",
  isha: "afterIsha",
};

type WorshipSheet = null | "rawatib" | "adhkar" | { reader: AdhkarSlot };

function App() {
  const { lang } = useI18n();
  const location = useLocation();
  const settings = useSettings();
  useWakeLock(); // keep the screen awake while the app is open
  const alarm = useAlarm(); // full-screen alarm when an alarm-kind reminder fires

  // Apply the persisted theme's side effects once on boot: index.html already
  // stamped data-theme pre-paint, but the theme-color meta + native system-bar
  // style are applied here (lib/theme.ts). A DEV `?theme=` override (main.tsx)
  // wins — don't clobber it with the persisted one.
  useEffect(() => {
    const devOverride =
      import.meta.env.DEV && new URLSearchParams(window.location.search).has("theme");
    if (!devOverride) applyTheme(settings.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const [tab, setTab] = useState<TabId>("home");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheet, setSheet] = useState<WorshipSheet>(null);

  // Native only: one-time removal of the 10-min default rule older builds seeded
  // (no-op on a fresh install and on devices whose default was edited).
  useEffect(() => {
    if (isNative()) migrateRemoveSeededDefault();
  }, []);

  // Native only: first launch asks for the alarm permissions right away
  // (notification dialog + the top missing system screen). One-time.
  useFirstRunPermissions();

  // Android hardware back: close the top-most overlay, else return to the Home
  // tab, else minimize the app.
  useAndroidBack(() => {
    // A ringing alarm swallows BACK: it is dismissed by swiping the ✕ up, the
    // same rule as the native AlarmActivity (users kept closing it by accident).
    if (alarm.alarm) return true;
    if (sheet !== null) {
      setSheet(null);
      return true;
    }
    if (searchOpen) {
      setSearchOpen(false);
      return true;
    }
    if (tab !== "home") {
      setTab("home");
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
        onOpen: () => setTab("reports"), // the record now lives on its own tab
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

  // One breath timeline for the whole screen: the period ramps with the next
  // prayer's countdown, and every breathing element (hero halo + next-prayer
  // card) inherits --glow-period / the animated --breath from this wrapper, so
  // they all breathe in perfect lockstep. No next prayer → calm slow breath.
  const breathPeriod = glowBreathPeriod(times.next?.msUntil ?? Number.POSITIVE_INFINITY);

  // Each page keeps living while hidden (state, timers, the breath phase).
  // Per-page scroll-column classes (the pager wrapper adds h-full + overflow).
  // Bottom padding = the overlay TabBar's per-theme footprint (+ the old 8px
  // gap), so content scrolls clear of — and visibly BEHIND — the bar (glass
  // translucency) while Home's no-scroll budget stays what it was in-flow.
  const pageClass =
    "flex flex-col gap-2.5 px-4 pt-3 pb-[calc(var(--tabbar-clearance)+0.5rem)]";

  // Swipe/slide is dead while any overlay owns the screen (search, worship
  // sheet, full-screen alarm) so a horizontal drag can't switch tabs behind it.
  const pagerEnabled = !alarm.alarm && sheet === null && !searchOpen;

  return (
    <div
      // Height must SUBTRACT the top safe-area inset: <body> already pads its top
      // by --inset-top (status-bar/notch), so a full 100dvh child would overflow
      // the viewport by exactly that inset and push the bottom tab bar off-screen
      // (real-Pixel: items clipped 12px under the gesture bar). On web --inset-top
      // is 0 → calc == 100dvh, unchanged. Bottom inset stays on the TabBar itself.
      className="breath-driver relative mx-auto flex w-full max-w-xl flex-col"
      style={
        {
          "--glow-period": `${breathPeriod.toFixed(2)}s`,
          height: "calc(100dvh - var(--inset-top))",
        } as CSSProperties
      }
    >
      <TabPager
        index={Math.max(0, TAB_IDS.indexOf(tab))}
        onChange={(i) => setTab(TAB_IDS[i])}
        enabled={pagerEnabled}
        pageClassName={pageClass}
      >
        <HomePage
          location={location}
          times={times}
          iqamaMinutes={settings.iqamaMinutes}
          features={settings.features}
          heroWorship={heroWorship}
          checkinFor={checkinFor}
          isFriday={isFriday}
          showLocationNeeded={showLocationNeeded}
          onOpenSearch={() => setSearchOpen(true)}
        />
        <TimesPage
          location={location}
          times={times}
          settings={settings}
          active={tab === "times"}
        />
        <ReportsPage
          stats={worship.stats}
          today={worship.today}
          features={settings.features}
          onEnableRecord={() => settings.setFeature("record", true)}
        />
        <SettingsPage
          push={push}
          iqamaMinutes={settings.iqamaMinutes}
          onChangeIqama={settings.setIqama}
          features={settings.features}
          onChangeFeature={settings.setFeature}
          alarmSound={settings.alarmSound}
          onChangeAlarmSound={settings.setAlarmSound}
          theme={settings.theme}
          onChangeTheme={settings.setTheme}
        />
      </TabPager>

      <TabBar tab={tab} onChange={setTab} />

      <CitySearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(loc) => location.setLocation(loc)}
        country={location.location?.country ?? null}
        onUseGps={() => void location.requestGps()}
        resolving={location.resolving}
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
