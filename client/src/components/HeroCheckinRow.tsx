// Contextual check-in row inside the hero: appears after a fard's adhan while
// it is still unmarked ("أين صلّيت العصر؟" + the icon-only trio); once marked
// it swaps to the post-prayer adhkar chip until those adhkar are read, then
// disappears entirely — the prompt lives exactly as long as it is actionable.

import { BookOpenText, ChevronLeft } from "lucide-react";
import {
  CheckinIconTrio,
  CHECKIN_TONES,
  TransientTip,
  useTransientText,
} from "@/components/CheckinControl";
import { useI18n } from "@/i18n/I18nProvider";
import { prayerNameKey } from "@/lib/prayer-names";
import type { FardPrayer, FardState } from "@/lib/worship-log";

interface HeroCheckinRowProps {
  prayer: FardPrayer;
  state: FardState;
  /** Post-prayer adhkar for this prayer already completed. */
  adhkarDone: boolean;
  onMark: (state: FardState) => void;
  onOpenAdhkar: () => void;
  /** Location-tz civil day is a Friday → dhuhr renders as الجمعة. */
  isFriday?: boolean;
}

export function HeroCheckinRow({ prayer, state, adhkarDone, onMark, onOpenAdhkar, isFriday }: HeroCheckinRowProps) {
  const { t } = useI18n();
  const [tip, showTip] = useTransientText();

  if (state === "unmarked") {
    return (
      <div className="relative w-full max-w-[280px] rounded-xl border border-border-soft bg-veil/[0.03] px-2.5 py-2">
        <p className="mb-2 text-center text-[12px] font-semibold leading-none text-ink-dim">
          {t("track.q", { prayer: t(prayerNameKey(prayer, !!isFriday)) })}
        </p>
        <CheckinIconTrio
          size="md"
          current={state}
          onPick={(k) => {
            onMark(k);
            showTip(t(CHECKIN_TONES[k].tipKey));
          }}
        />
        {tip && <TransientTip text={tip} className="-top-3 left-1/2 -translate-x-1/2" />}
      </div>
    );
  }

  if (adhkarDone) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpenAdhkar}
        className="flex items-center gap-1.5 rounded-full border border-teal/40 bg-teal/[0.06] px-3 py-1.5 text-[12px] font-bold leading-none text-teal transition-colors hover:bg-teal/10"
      >
        <BookOpenText className="size-4" />
        {t("track.adhkarChip")}
        <ChevronLeft className="size-3.5 rtl:block ltr:hidden" />
      </button>
      {tip && <TransientTip text={tip} className="-top-9 left-1/2 -translate-x-1/2" />}
    </div>
  );
}
