// Reports · per-prayer breakdown — one stacked masjid/home/missed bar per fard
// over the retained 62-day window. The legend uses the check-in trio's icons
// and tones (MosqueIcon gold / Home teal / X critical — CheckinControl
// conventions) instead of the mock's plain dots, per the spec. Rows with no
// marks render a neutral track (the mock divided by zero — deliberately not
// copied).

import { Home, X } from "lucide-react";
import { MosqueIcon } from "@/components/ui/MosqueIcon";
import { useI18n } from "@/i18n/I18nProvider";
import { prayerNameKey } from "@/lib/prayer-names";
import { FARD_PRAYERS, type FardPrayer } from "@/lib/worship-log";
import type { PerPrayerCounts } from "@/lib/worship-stats";
import type { ReactNode } from "react";

interface PerPrayerBreakdownProps {
  perPrayer: Record<FardPrayer, PerPrayerCounts>;
}

function LegendItem({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {icon}
      {label}
    </span>
  );
}

export function PerPrayerBreakdown({ perPrayer }: PerPrayerBreakdownProps) {
  const { t } = useI18n();

  return (
    <section className="card p-4">
      <h2 className="mb-1 text-[13px] font-bold text-ink-dim">{t("reports.perPrayerTitle")}</h2>
      <div className="mb-2 flex items-center gap-3 text-[10px] text-ink-faint">
        <LegendItem icon={<MosqueIcon className="size-3 text-gold" />} label={t("track.masjid")} />
        <LegendItem icon={<Home className="size-3 text-teal" />} label={t("track.home")} />
        <LegendItem icon={<X className="size-3 text-critical" />} label={t("track.missed")} />
      </div>
      <div className="flex flex-col gap-2">
        {FARD_PRAYERS.map((p) => {
          const c = perPrayer[p];
          const total = c.masjid + c.home + c.missed;
          return (
            <div key={p} className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-[12px] font-semibold text-ink-dim">
                {t(prayerNameKey(p, false))}
              </span>
              <div className="flex h-3 flex-1 overflow-hidden rounded-full">
                {total === 0 ? (
                  <span className="w-full bg-veil/[0.06]" />
                ) : (
                  <>
                    <span style={{ width: `${(c.masjid / total) * 100}%`, background: "var(--color-gold)" }} />
                    <span style={{ width: `${(c.home / total) * 100}%`, background: "var(--color-teal)" }} />
                    <span style={{ width: `${(c.missed / total) * 100}%`, background: "var(--color-critical)" }} />
                  </>
                )}
              </div>
              <span className="tnum w-8 shrink-0 text-end text-[11px] font-bold text-ink-dim">
                {c.masjid + c.home}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
