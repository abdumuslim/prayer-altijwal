// Horizontal 6-cell prayer strip for the Home tab (v2 shell — docs/
// V2_REDESIGN_SPEC.md Phase 4, user-approved mock). Replaces the 2-column
// PrayerList on Home (the full list lives on the المواقيت tab). One glanceable
// row: name over clock time; the next prayer's cell breathes with the shared
// --breath driver, tinted by its proximity accent; passed prayers dim.

import type { CSSProperties } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { proximityStyle } from "@/components/ui/proximity";
import { localizeTimeString, proximityFromMs } from "@/lib/format";
import { prayerNameKey } from "@/lib/prayer-names";
import { cn } from "@/lib/utils";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";

interface PrayerStripProps {
  prayers: DerivedPrayer[];
  isFriday?: boolean;
}

/** Strip the day-period suffix (ص/م, AM/PM) — the cell is too small for it. */
function compactTime(time: string): string {
  return time.replace(/\s*(ص|م|AM|PM)$/i, "");
}

export function PrayerStrip({ prayers, isFriday }: PrayerStripProps) {
  const { t, lang } = useI18n();

  return (
    // 3×2 grid (two rows) — roomier cells than a single 6-col strip (user).
    <section className="card grid grid-cols-3 gap-1 px-2 py-2">
      {prayers.map((p) => {
        const style = p.isNext ? proximityStyle(proximityFromMs(p.msUntil)) : null;
        return (
          <div
            key={p.name}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl py-2",
              p.isNext && "breath-glow bg-veil/[0.06]",
            )}
            style={style ? ({ "--prox": style.ring } as CSSProperties) : undefined}
          >
            <span
              className={cn(
                "text-[13px] font-semibold leading-none",
                p.isNext ? style?.text : p.isPassed ? "text-ink-faint" : "text-ink-dim",
              )}
            >
              {t(prayerNameKey(p.name, !!isFriday))}
            </span>
            <span
              className={cn(
                "tnum text-[15px] font-bold leading-none",
                p.isPassed && !p.isNext ? "text-ink-faint" : "text-ink",
              )}
            >
              {compactTime(localizeTimeString(p.time, lang))}
            </span>
          </div>
        );
      })}
    </section>
  );
}
