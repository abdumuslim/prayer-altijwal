// Adhkar checklist sheet (opened from the bottom-left corner ring): the daily
// pair (morning/evening, the corner's 2) on top, then the five after-prayer
// lists. Each open row starts the tap-to-count reader; done rows show the +1.

import { Check, CheckCircle2, ChevronLeft, Circle, Lock } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { useI18n } from "@/i18n/I18nProvider";
import { prayerNameKey } from "@/lib/prayer-names";
import { cn } from "@/lib/utils";
import {
  ADHKAR_SLOTS,
  type AdhkarSlot,
  type DayLog,
  type WorshipMark,
} from "@/lib/worship-log";
import type { PrayerName } from "@/types/api";

interface AdhkarSheetProps {
  open: boolean;
  onClose: () => void;
  today: DayLog;
  canMark: (mark: WorshipMark) => boolean;
  onOpenReader: (slot: AdhkarSlot) => void;
  mark: (mark: WorshipMark) => void;
  /** Location-tz civil day is a Friday → "بعد الظهر" reads "بعد الجمعة". */
  isFriday?: boolean;
}

const AFTER_PRAYER: Record<string, PrayerName> = {
  afterFajr: "fajr",
  afterDhuhr: "dhuhr",
  afterAsr: "asr",
  afterMaghrib: "maghrib",
  afterIsha: "isha",
};

export function AdhkarSheet({ open, onClose, today, canMark, onOpenReader, mark, isFriday }: AdhkarSheetProps) {
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
        : t("adhkar.afterPrayer", { prayer: t(prayerNameKey(AFTER_PRAYER[slot], !!isFriday)) });

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
          const done = today.adhkar[slot];
          return (
            <div
              key={slot}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2",
                // group break between the daily pair and the after-prayer five
                i === 2 && "mt-1.5",
                state === "done" && "border-transparent bg-veil/[0.05]",
                state === "open" && "border-teal/40 bg-teal/[0.04]",
                state === "locked" && "border-border-soft/50 bg-veil/[0.01]",
              )}
            >
              {/* Row body opens the tap-to-count reader (locked before adhan). */}
              <button
                type="button"
                disabled={state === "locked"}
                onClick={() => state !== "locked" && onOpenReader(slot)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
              >
                {state === "done" ? (
                  <Check className="size-5 shrink-0 text-teal" />
                ) : state === "open" ? (
                  <Circle className="size-5 shrink-0 text-teal/70" />
                ) : (
                  <Lock className="size-4 shrink-0 text-ink-faint" />
                )}
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className={cn("text-[15px] font-semibold leading-none", state === "done" ? "text-ink" : "text-ink-dim")}>
                    {label(slot)}
                  </span>
                  {rowNote && <span className="text-[10.5px] leading-none text-ink-faint">{rowNote}</span>}
                </span>
                {state === "open" && (
                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-teal">
                    {t("adhkar.start")}
                    <ChevronLeft className="size-3.5" />
                  </span>
                )}
              </button>
              {/* Manual check-off — for adhkar recited outside the app. Tapping a
                  done row's toggle undoes it (mirrors the Duha/Qiyam satellites). */}
              {state !== "locked" && (
                <button
                  type="button"
                  aria-label={label(slot)}
                  aria-pressed={done}
                  onClick={() => mark({ kind: "adhkar", slot, done: !done })}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border transition-transform active:scale-90",
                    done ? "border-teal/60 bg-teal/10 text-teal" : "border-border text-ink-faint",
                  )}
                >
                  <CheckCircle2 className="size-5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}
