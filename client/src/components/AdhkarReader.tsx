// The tap-to-count adhkar reader: done items compact with checks, the current
// dhikr as a large card (the WHOLE card is the tap target) with a counter
// ring, upcoming items dimmed. Completing every item auto-awards the +1 (the
// hook marks the slot) and the reader celebrates with a filled check.

import { Check, Star } from "lucide-react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { useI18n } from "@/i18n/I18nProvider";
import { ADHKAR_LISTS, listProgress } from "@/lib/adhkar-data";
import { prayerNameKey } from "@/lib/prayer-names";
import type { AdhkarSlot } from "@/lib/worship-log";
import type { PrayerName } from "@/types/api";

interface AdhkarReaderProps {
  open: boolean;
  onClose: () => void;
  slot: AdhkarSlot;
  /** Today's tap counts for this slot (empty when untouched). */
  counts: number[];
  onCount: (itemIndex: number, count: number) => void;
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

export function AdhkarReader({ open, onClose, slot, counts, onCount, isFriday }: AdhkarReaderProps) {
  const { t } = useI18n();
  const items = ADHKAR_LISTS[slot];
  const currentIdx = items.findIndex((item, i) => (counts[i] ?? 0) < item.repeat);
  const complete = currentIdx === -1;
  const doneItems = items.filter((item, i) => (counts[i] ?? 0) >= item.repeat).length;

  const title =
    slot === "morning"
      ? t("adhkar.morning")
      : slot === "evening"
        ? t("adhkar.evening")
        : t("adhkar.readerAfter", { prayer: t(prayerNameKey(AFTER_PRAYER[slot], !!isFriday)) });

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      badge={
        <span className="tnum rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-bold text-teal">
          {doneItems}/{items.length}
        </span>
      }
    >
      <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-veil/[0.08]">
        <div
          className="h-full rounded-full bg-teal"
          style={{ width: `${listProgress(counts, items) * 100}%`, transition: "width 0.3s ease" }}
        />
      </div>

      {complete ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="satellite-glow grid size-20 place-items-center rounded-full bg-teal" style={{ "--sat": "var(--color-teal)" } as React.CSSProperties}>
            <Check className="size-10 text-on-accent" strokeWidth={4} />
          </div>
          <p className="flex items-center gap-1.5 text-sm font-bold text-gold">
            <Star className="size-4" fill="currentColor" />
            {t("adhkar.reward")}
          </p>
        </div>
      ) : (
        <>
          {/* done items — compact, checked */}
          {doneItems > 0 && (
            <div className="mb-2 flex flex-col gap-1">
              {items.map((item, i) =>
                (counts[i] ?? 0) >= item.repeat ? (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-[13px] text-ink-faint">
                    <Check className="size-3.5 shrink-0 text-teal" />
                    <span className="truncate font-serif-ar">
                      {item.textAr}
                      {item.repeat > 1 && <span className="tnum"> ×{item.repeat}</span>}
                    </span>
                  </div>
                ) : null,
              )}
            </div>
          )}

          {/* current dhikr — the whole card counts a tap */}
          <button
            type="button"
            onClick={() => onCount(currentIdx, (counts[currentIdx] ?? 0) + 1)}
            className="mb-2 flex w-full flex-col items-center gap-3 rounded-2xl border border-teal/40 bg-teal/[0.06] p-4 transition-colors active:bg-teal/[0.12]"
          >
            <span className="font-serif-ar text-xl leading-relaxed text-ink">
              {items[currentIdx].textAr}
            </span>
            <ProgressRing
              progress={(counts[currentIdx] ?? 0) / items[currentIdx].repeat}
              size={88}
              stroke={6}
              color="var(--color-teal)"
            >
              <span className="flex flex-col items-center leading-none">
                <span className="tnum text-2xl font-extrabold text-teal">{counts[currentIdx] ?? 0}</span>
                <span className="tnum text-[11px] text-ink-dim">/{items[currentIdx].repeat}</span>
              </span>
            </ProgressRing>
            <span className="text-[11px] leading-none text-ink-faint">{t("adhkar.tapHint")}</span>
          </button>

          {/* upcoming — dimmed */}
          <div className="flex flex-col gap-1">
            {items.map((item, i) =>
              i > currentIdx ? (
                <div key={item.id} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-[13px] text-ink-dim opacity-70">
                  <span className="size-1.5 shrink-0 rounded-full bg-veil/25" />
                  <span className="truncate font-serif-ar">
                    {item.textAr}
                    {item.repeat > 1 && <span className="tnum"> ×{item.repeat}</span>}
                  </span>
                </div>
              ) : null,
            )}
          </div>

          <p className="mt-3 flex items-center justify-center gap-1 text-[11px] font-semibold text-gold">
            <Star className="size-3.5" fill="currentColor" />
            {t("adhkar.reward")}
          </p>
        </>
      )}
    </BottomSheet>
  );
}
