// Hero live timer to the next prayer: a single header line + a progress ring
// (depleting across the interval) holding the prayer name, the live countdown,
// and the prayer's clock time. Hosts the worship tracker's hero widgets: the
// score pill (top corner), the four mini rings (Duha/Qiyam satellites on top,
// rawatib/adhkar corners below), the iqama bar and the contextual check-in
// row. Kept vertically compact so it fits on a phone.

import { useMemo } from "react";
import { MoonStar, SunMedium } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { proximityStyle } from "@/components/ui/proximity";
import { SatelliteRing } from "@/components/SatelliteRing";
import { IqamaBar } from "@/components/IqamaBar";
import { CornerRing } from "@/components/CornerRing";
import { HeroCheckinRow } from "@/components/HeroCheckinRow";
import { ScorePill } from "@/components/ScorePill";
import {
  formatCountdown,
  intervalProgress,
  localizeTimeString,
} from "@/lib/format";
import { deriveIqama, deriveSatellite } from "@/lib/hero-extras";
import { prayerNameKey } from "@/lib/prayer-names";
import { cn } from "@/lib/utils";
import type { DerivedNext, DerivedPrayer } from "@/hooks/usePrayerTimes";
import type { CornerVM } from "@/lib/worship-vm";
import type { FardPrayer, FardState } from "@/lib/worship-log";
import type { PrayerName, SunnahWindow } from "@/types/api";
import type { IqamaMinutes, WorshipFeatures } from "@/lib/storage";
import type { StringKey } from "@/i18n/strings.en";

/** Everything the hero needs from the worship tracker (built in App). */
export interface HeroWorship {
  pill: { points: number; streak: number; onOpen: () => void };
  rawatib: CornerVM & { onOpen: () => void };
  adhkar: CornerVM & { onOpen: () => void };
  duhaDone: boolean;
  qiyamDone: boolean;
  onToggleDuha: () => void;
  onToggleQiyam: () => void;
  checkin: {
    prayer: FardPrayer;
    state: FardState;
    adhkarDone: boolean;
    onMark: (state: FardState) => void;
    onOpenAdhkar: () => void;
  } | null;
}

interface NextPrayerCountdownProps {
  next: DerivedNext | null;
  now: number;
  duhaWindow: SunnahWindow | null;
  qiyamWindow: SunnahWindow | null;
  prayers: DerivedPrayer[];
  iqamaMinutes: IqamaMinutes;
  worship: HeroWorship | null;
  /** Opt-in worship features — each hero widget renders only when enabled. */
  features: WorshipFeatures;
  /** Location-tz civil day is a Friday → dhuhr renders as الجمعة. */
  isFriday?: boolean;
}

export function NextPrayerCountdown({
  next,
  now,
  duhaWindow,
  qiyamWindow,
  prayers,
  iqamaMinutes,
  worship,
  features,
  isFriday,
}: NextPrayerCountdownProps) {
  const { t, lang } = useI18n();

  const style = useMemo(
    () => proximityStyle(next?.proximity ?? "safe"),
    [next?.proximity],
  );

  // Secondary worship-time aids, recomputed each tick from the same `now`.
  const duhaState = useMemo(() => deriveSatellite(duhaWindow, now), [duhaWindow, now]);
  const qiyamState = useMemo(() => deriveSatellite(qiyamWindow, now), [qiyamWindow, now]);
  const iqamaState = useMemo(
    () => deriveIqama(prayers, iqamaMinutes, now),
    [prayers, iqamaMinutes, now],
  );

  if (!next) {
    return (
      <section className="card arabesque animate-rise-in flex min-h-[220px] items-center justify-center p-8 text-center">
        <p className="text-ink-dim">{t("loading.times")}</p>
      </section>
    );
  }

  const clock = formatCountdown(next.timestamp, now, lang);
  const progress = intervalProgress(next.intervalStart, next.timestamp, now);
  const ringProgress = 1 - progress; // depletes as time passes

  return (
    <section className="card arabesque animate-rise-in relative overflow-hidden p-4 sm:p-5">
      {/* soft radial accent behind the ring — physical `left-1/2` so it stays
          centred under both LTR and RTL. Breathes (scale + opacity) off the shared
          --breath so it stays in lockstep with the next-prayer card. */}
      <div
        className="halo-breath pointer-events-none absolute -top-24 left-1/2 h-80 w-80 rounded-full blur-3xl"
        style={{ background: style.ring }}
        aria-hidden="true"
      />

      {features.record && worship && (
        <ScorePill
          points={worship.pill.points}
          streak={worship.pill.streak}
          onClick={worship.pill.onOpen}
          className="absolute end-2.5 top-2.5 z-20"
        />
      )}

      {/* Sunnah satellites — physically pinned (Duha top-right, Qiyam top-left) so
          they keep their corners under both LTR and RTL. Nudged down 15px so the
          score pill owns the top corner while the 4-ring cluster stays centered on
          the big ring's vertical midline. Tapping toggles the done state (filled
          disc + check). */}
      {/* z-10 is REQUIRED here: the translate-y creates a stacking context, so the
          buttons' own z-10 is local to it — without lifting the wrapper, the
          DOM-later content column hit-tests above the satellites and swallows
          real clicks (elementFromPoint-verified). pointer-events-none keeps the
          rest of the overlay click-through. */}
      {(features.duha || features.qiyam) && (
        <div className="pointer-events-none absolute inset-0 z-10 translate-y-[15px]">
          {features.duha && duhaState && (
            <SatelliteRing
              icon={SunMedium}
              label={t("sunnah.duha")}
              state={duhaState}
              color="var(--color-amber)"
              side="right"
              now={now}
              lang={lang}
              done={worship?.duhaDone}
              onClick={worship?.onToggleDuha}
            />
          )}
          {features.qiyam && qiyamState && (
            <SatelliteRing
              icon={MoonStar}
              label={t("sunnah.qiyam")}
              state={qiyamState}
              color="var(--color-indigo)"
              side="left"
              now={now}
              lang={lang}
              done={worship?.qiyamDone}
              onClick={worship?.onToggleQiyam}
            />
          )}
        </div>
      )}

      {/* Worship corner rings — flank the main ring's lower arc (top-anchored so
          they don't move when the check-in row appears/disappears below). */}
      {features.rawatib && worship && (
        <CornerRing
          label={t("rawatib.label")}
          caption={t(worship.rawatib.captionKey as StringKey)}
          color="var(--color-sky)"
          side="right"
          progress={worship.rawatib.progress}
          active={worship.rawatib.active}
          complete={worship.rawatib.complete}
          onClick={worship.rawatib.onOpen}
          posClass="top-[157px]"
          dimWhenIdle={false}
        >
          <span className="tnum text-[13px] font-extrabold leading-none text-sky">
            {worship.rawatib.centerText}
          </span>
        </CornerRing>
      )}
      {features.adhkar && worship && (
        <CornerRing
          label={t("adhkar.label")}
          caption={t(worship.adhkar.captionKey as StringKey)}
          color="var(--color-teal)"
          side="left"
          progress={worship.adhkar.progress}
          active={worship.adhkar.active}
          complete={worship.adhkar.complete}
          onClick={worship.adhkar.onOpen}
          posClass="top-[157px]"
        >
          <span className="tnum text-[13px] font-extrabold leading-none text-teal">
            {worship.adhkar.centerText}
          </span>
        </CornerRing>
      )}

      <div className="relative flex flex-col items-center gap-2">
        <div className="flex items-center justify-center gap-2 text-center">
          <span className={cn("text-base font-semibold", style.text)}>
            {next.msUntil <= 0 ? t("next.now") : t("next.header")}
          </span>
          {next.tomorrow && (
            <span className="rounded-full bg-veil/5 px-2 py-0.5 text-[12px] font-medium text-ink-dim">
              {t("next.tomorrow")}
            </span>
          )}
        </div>

        <ProgressRing
          progress={ringProgress}
          size={192}
          stroke={10}
          color={style.ring}
        >
          {/* Height-constrained column so the three lines breathe (justify-between)
              while staying inside the ring's inscribed area — never touching it. */}
          <div className="flex h-[58%] flex-col items-center justify-between text-center">
            <span className="text-2xl font-bold leading-none text-gold">
              {t(prayerNameKey(next.name as PrayerName, !!isFriday))}
            </span>
            <span
              className={cn(
                "tnum text-[1.85rem] font-extrabold leading-none tracking-tight",
                style.text,
              )}
            >
              {clock}
            </span>
            <span className="text-base leading-none text-ink-dim">
              {localizeTimeString(next.time, lang)}
            </span>
          </div>
        </ProgressRing>

        {/* Breathing room below the ring: the corner rings' captions hang past
            the ring's lower arc, so without this they touch the card's bottom
            edge (when nothing follows) or the row below (iqama bar / check-in
            "أين صليت"). Only reserved when a corner ring is actually shown. */}
        {(features.rawatib || features.adhkar) && <div aria-hidden className="h-3" />}

        {/* Iqama countdown bar — only between a prayer's adhan and its iqama.
            Narrowed so the corner rings' captions never collide with it. */}
        {iqamaState && (
          <div
            className={cn(
              "flex w-full justify-center",
              (features.rawatib || features.adhkar) && "max-w-[200px] self-center",
            )}
          >
            <IqamaBar state={iqamaState} now={now} isFriday={isFriday} />
          </div>
        )}

        {/* Contextual check-in: question → adhkar chip → gone (see HeroCheckinRow).
            Suppressed while the iqama bar runs — the prayer hasn't happened yet,
            so asking "where did you pray" would be premature (and the two tall
            elements would overflow small phones together). */}
        {features.record && worship?.checkin && !iqamaState && (
          <HeroCheckinRow
            prayer={worship.checkin.prayer}
            state={worship.checkin.state}
            adhkarDone={worship.checkin.adhkarDone}
            onMark={worship.checkin.onMark}
            onOpenAdhkar={worship.checkin.onOpenAdhkar}
            isFriday={isFriday}
          />
        )}
      </div>
    </section>
  );
}
