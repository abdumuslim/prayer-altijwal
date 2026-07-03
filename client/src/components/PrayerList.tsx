// The six prayer times as a compact 2-column grid (3 natural-height rows).

import { PrayerCard, type CardCheckin } from "@/components/PrayerCard";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";
import type { PrayerName } from "@/types/api";

interface PrayerListProps {
  prayers: DerivedPrayer[];
  now: number;
  /** Worship check-in control per fard prayer (null for sunrise/none). */
  checkinFor?: (name: PrayerName) => CardCheckin | null;
}

export function PrayerList({ prayers, now, checkinFor }: PrayerListProps) {
  return (
    <section className="card animate-rise-in grid grid-cols-2 gap-2 p-3 sm:p-4">
      {prayers.map((p) => (
        <PrayerCard key={p.name} prayer={p} now={now} checkin={checkinFor?.(p.name) ?? null} />
      ))}
    </section>
  );
}
