// Adhkar checklist sheet (opened from the bottom-left corner ring): the daily
// pair (morning/evening, the corner's 2) on top, then the five after-prayer
// lists. Each open row starts the tap-to-count reader; done rows show the +1.

import { Check, ChevronLeft, Circle, Lock } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  ADHKAR_SLOTS,
  type AdhkarSlot,
  type DayLog,
  type WorshipMark,
} from "@/lib/worship-log";
import type { StringKey } from "@/i18n/strings.en";

interface AdhkarSheetProps {
  open: boolean;
  onClose: () => void;
  today: DayLog;
  canMark: (mark: WorshipMark) => boolean;
  onOpenReader: (slot: AdhkarSlot) => void;
}

const AFTER_PRAYER: Record<string, string> = {
  afterFajr: "prayer.fajr",
  afterDhuhr: "prayer.dhuhr",
  afterAsr: "prayer.asr",
  afterMaghrib: "prayer.maghrib",
  afterIsha: "prayer.isha",
};

export function AdhkarSheet({ open, onClose, today, canMark, onOpenReader }: AdhkarSheetProps) {
  const { t } = useI18n();
  const doneCount = ADHKAR_SLOTS.filter((s) => today.adhkar[s]).length;

  const rowState = (slot: AdhkarSlot): "done" | "open" | "locked" => {
    if (today.adhkar[slot]) return "done";
    return canMark({ kind: "adhkar", slot, done: true }) ? "open" : "locked";
  };

  const label = (slot: AdhkarSlot): string =>
    slot === "morning"
      ? t("adhkar.morning")
      : slot === "evening"
        ? t("adhkar.evening")
        : t("adhkar.afterPrayer", { prayer: t(AFTER_PRAYER[slot] as StringKey) });

  const note = (slot: AdhkarSlot): string | null =>
    slot === "morning" ? t("adhkar.morningNote") : slot === "evening" ? t("adhkar.eveningNote") : null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("adhkar.title")}
      badge={
        <span className="tnum rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-bold text-teal">
          {doneCount}/{ADHKAR_SLOTS.length}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5">
        {ADHKAR_SLOTS.map((slot, i) => {
          const state = rowState(slot);
          const rowNote = note(slot);
          return (
            <button
              key={slot}
              type="button"
              disabled={state === "locked"}
              onClick={() => state !== "locked" && onOpenReader(slot)}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-start",
                // group break between the daily pair and the after-prayer five
                i === 2 && "mt-1.5",
                state === "done" && "border-transparent bg-white/[0.05]",
                state === "open" && "border-teal/40 bg-teal/[0.04]",
                state === "locked" && "border-border-soft/50 bg-white/[0.01] opacity-45",
              )}
            >
              {state === "done" ? (
                <Check className="size-5 shrink-0 text-teal" />
              ) : state === "open" ? (
                <Circle className="size-5 shrink-0 text-teal/70" />
              ) : (
                <Lock className="size-4 shrink-0 text-ink-faint" />
              )}
              <span className="flex flex-1 flex-col items-start gap-0.5">
                <span className={cn("text-[15px] font-semibold leading-none", state === "done" ? "text-ink" : "text-ink-dim")}>
                  {label(slot)}
                </span>
                {rowNote && <span className="text-[10.5px] leading-none text-ink-faint">{rowNote}</span>}
              </span>
              {state === "done" ? (
                <span className="tnum text-[11px] font-bold text-teal">+1</span>
              ) : state === "open" ? (
                <span className="flex items-center gap-0.5 text-[11px] font-bold text-teal">
                  {t("adhkar.start")}
                  <ChevronLeft className="size-3.5" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
