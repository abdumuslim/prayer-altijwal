// The six prayer times as compact single-column rows (v2: lives on the
// المواقيت tab — Home shows the PrayerStrip instead). One row per prayer keeps
// full names at 360px (the old 2-col cards truncated الظهر/العشاء next to the
// check-in icon) and reads lighter above the monthly table.

import { PrayerCard, type CardCheckin } from "@/components/PrayerCard";
import type { DerivedPrayer } from "@/hooks/usePrayerTimes";
import type { PrayerName } from "@/types/api";

interface PrayerListProps {
  prayers: DerivedPrayer[];
  now: number;
  /** Worship check-in control per fard prayer (null for sunrise/none). */
  checkinFor?: (name: PrayerName) => CardCheckin | null;
  /** Location-tz civil day is a Friday → dhuhr renders as الجمعة. */
  isFriday?: boolean;
}

export function PrayerList({ prayers, now, checkinFor, isFriday }: PrayerListProps) {
  return (
    <section className="card animate-rise-in flex flex-col gap-1.5 p-3">
      {prayers.map((p) => (
        <PrayerCard key={p.name} prayer={p} now={now} checkin={checkinFor?.(p.name) ?? null} isFriday={isFriday} />
      ))}
    </section>
  );
}
