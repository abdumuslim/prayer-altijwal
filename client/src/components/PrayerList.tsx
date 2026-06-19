// The six prayer rows. Sunrise is shown but rendered slightly distinct (it's a
// marker, not a prayer) — kept in the list for completeness.

import { PrayerCard } from "@/components/PrayerCard";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";

interface PrayerListProps {
  prayers: DerivedPrayer[];
  now: number;
}

export function PrayerList({ prayers, now }: PrayerListProps) {
  return (
    <section className="card animate-rise-in flex flex-col gap-2 p-3 sm:p-4">
      {prayers.map((p) => (
        <PrayerCard key={p.name} prayer={p} now={now} />
      ))}
    </section>
  );
}
