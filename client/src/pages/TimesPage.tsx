// المواقيت tab (v2 shell — docs/V2_REDESIGN_SPEC.md Phase 3 stub).
// Phase 5 adds the month table + moves today's full list here permanently;
// until then it shows today's list so the tab is never empty during testing.

import { PrayerList } from "@/components/PrayerList";
import type { CardCheckin } from "@/components/PrayerCard";
import type { usePrayerTimes } from "@/hooks/usePrayerTimes";
import type { PrayerName } from "@/types/api";

interface TimesPageProps {
  times: ReturnType<typeof usePrayerTimes>;
  checkinFor: (name: PrayerName) => CardCheckin | null;
  isFriday: boolean;
}

export function TimesPage({ times, checkinFor, isFriday }: TimesPageProps) {
  if (!times.data) return null;
  return (
    <PrayerList
      prayers={times.prayers}
      now={times.now}
      checkinFor={checkinFor}
      isFriday={isFriday}
    />
  );
}
