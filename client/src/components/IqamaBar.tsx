// The iqama progress bar below the hero ring. Appears only between a prayer's
// adhan and its iqama, depleting left→right; blinks during the final minute, then
// unmounts at iqama. Caller renders it only when deriveIqama returns a state.

import { useI18n } from "@/i18n/I18nProvider";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { formatCountdown, proximityFromMs } from "@/lib/format";
import { proximityStyle } from "@/components/ui/proximity";
import { prayerNameKey } from "@/lib/prayer-names";
import { cn } from "@/lib/utils";
import type { IqamaState } from "@/lib/hero-extras";

interface IqamaBarProps {
  state: IqamaState;
  now: number;
  /** Location-tz civil day is a Friday → dhuhr renders as الجمعة. */
  isFriday?: boolean;
}

export function IqamaBar({ state, now, isFriday }: IqamaBarProps) {
  const { t, lang } = useI18n();
  const Icon = PRAYER_ICONS[state.prayer];
  // Absolute proximity palette (green→yellow→orange→red at 15/10/5/1 min to
  // iqama), same as the hero + list. So a 5-min Maghrib iqama is red throughout
  // (it is, by definition, within the 5-min critical band), while a 25-min Fajr
  // iqama walks the full palette.
  const style = proximityStyle(proximityFromMs(state.msUntil));

  return (
    // A11y (Phase 8): a stable-named timer — the per-second countdown text and
    // the progress bar are aria-hidden so TalkBack announces the bar ONCE
    // («توقيت الإقامة — العصر»), not every tick.
    <div
      role="timer"
      aria-label={`${t("iqama.title")} — ${t(prayerNameKey(state.prayer, !!isFriday))}`}
      className={cn("mt-2 w-full max-w-[320px] px-1", state.blinking && "iqama-blink")}
    >
      <div className="mb-1.5 flex items-center justify-between text-[13px] font-semibold leading-none">
        <span className="flex items-center gap-1.5 text-ink-dim">
          <Icon className={cn("size-4", style.text)} />
          {t(prayerNameKey(state.prayer, !!isFriday))}
        </span>
        <span aria-hidden="true" className={cn("tnum", style.text)}>
          {t("iqama.in", { time: formatCountdown(state.iqamaTs, now, lang) })}
        </span>
      </div>
      <div aria-hidden="true" className="h-2.5 w-full overflow-hidden rounded-full bg-veil/[0.08]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${state.progress * 100}%`,
            background: `linear-gradient(to right, color-mix(in srgb, ${style.ring} 40%, transparent), ${style.ring})`,
            transition: "width 1s linear, background 0.4s ease",
          }}
        />
      </div>
    </div>
  );
}
