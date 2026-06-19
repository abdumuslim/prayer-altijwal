// The six prayer times as a compact 2-column grid (3 natural-height rows).

import { PrayerCard } from "@/components/PrayerCard";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";

interface PrayerListProps {
  prayers: DerivedPrayer[];
  now: number;
}

export function PrayerList({ prayers, now }: PrayerListProps) {
  return (
    <section className="card animate-rise-in grid grid-cols-2 gap-2 p-3 sm:p-4">
      {prayers.map((p) => (
        <PrayerCard key={p.name} prayer={p} now={now} />
      ))}
    </section>
  );
}
