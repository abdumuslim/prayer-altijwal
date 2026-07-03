// Rawatib detail sheet (opened from the bottom-right corner ring): the five
// sunnah slots as check rows. A slot unlocks at its parent prayer's adhan
// (worship-windows), toggles on tap, and shows its rakaat count + the +1.

import { Check, Circle, Lock, Star } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  RAWATIB_RAKAAT,
  RAWATIB_SLOTS,
  type DayLog,
  type RawatibSlot,
  type WorshipMark,
} from "@/lib/worship-log";
import type { StringKey } from "@/i18n/strings.en";

interface RawatibSheetProps {
  open: boolean;
  onClose: () => void;
  today: DayLog;
  canMark: (mark: WorshipMark) => boolean;
  mark: (mark: WorshipMark) => void;
}

export function RawatibSheet({ open, onClose, today, canMark, mark }: RawatibSheetProps) {
  const { t } = useI18n();
  const rakaatDone = RAWATIB_SLOTS.reduce(
    (sum, s) => sum + (today.rawatib[s] ? RAWATIB_RAKAAT[s] : 0),
    0,
  );

  const rowState = (slot: RawatibSlot): "done" | "open" | "locked" => {
    if (today.rawatib[slot]) return "done";
    return canMark({ kind: "rawatib", slot, done: true }) ? "open" : "locked";
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("rawatib.title")}
      badge={
        <span className="tnum rounded-full bg-sky/10 px-2 py-0.5 text-[11px] font-bold text-sky">
          {t("rawatib.rakaat", { n: `${rakaatDone}/12` })}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5">
        {RAWATIB_SLOTS.map((slot) => {
          const state = rowState(slot);
          return (
            <button
              key={slot}
              type="button"
              disabled={state === "locked"}
              onClick={() => mark({ kind: "rawatib", slot, done: !today.rawatib[slot] })}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start",
                state === "done" && "border-transparent bg-white/[0.05]",
                state === "open" && "border-dashed border-warning/50 bg-white/[0.02]",
                state === "locked" && "border-border-soft/50 bg-white/[0.01] opacity-45",
              )}
            >
              {state === "done" ? (
                <Check className="size-5 shrink-0 text-sky" />
              ) : state === "open" ? (
                <Circle className="size-5 shrink-0 text-warning/70" />
              ) : (
                <Lock className="size-4 shrink-0 text-ink-faint" />
              )}
              <span className={cn("flex-1 text-[15px] font-semibold", state === "done" ? "text-ink" : "text-ink-dim")}>
                {t(`rawatib.${slot}` as StringKey)}
              </span>
              <span className="tnum rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-ink-dim">
                {t("rawatib.rakaat", { n: String(RAWATIB_RAKAAT[slot]) })}
              </span>
              {state === "done" && <span className="tnum text-[11px] font-bold text-sky">+1</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex items-center justify-center gap-1 text-[11px] font-semibold text-ink-dim">
        <Star className="size-3.5 text-gold" fill="var(--color-gold)" />
        {t("rawatib.footer")}
      </p>
    </BottomSheet>
  );
}
