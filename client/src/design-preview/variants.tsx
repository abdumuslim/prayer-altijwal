// The four full-screen layout variants (DEV-only design preview).

import {
  DayStrip,
  MockHero,
  MockNextEvent,
  MockPrayerGrid,
  MockTopBar,
  TrackerCard,
} from "./shared";

/** 1 — "الزوايا الأربع": rawatib+adhkar corner rings; check-in icons on cards. */
export function Variant1() {
  return (
    <>
      <MockTopBar />
      <MockHero corners={4} scorePill />
      <MockPrayerGrid mode="icon" />
      <MockNextEvent />
    </>
  );
}

/** 2 — "شريط اليوم": hero untouched; one glanceable tracker strip below it. */
export function Variant2() {
  return (
    <>
      <MockTopBar />
      <MockHero corners={2} />
      <DayStrip popover />
      <MockPrayerGrid mode="plain" />
      <MockNextEvent />
    </>
  );
}

/** 3 — "سياقي": corner rings + one-tap check-in row inside the hero at the right moment. */
export function Variant3() {
  return (
    <>
      <MockTopBar />
      <MockHero corners={4} checkinRow scorePill />
      <MockPrayerGrid mode="icon" />
      <MockNextEvent />
    </>
  );
}

/** 4 — "بطاقة الإنجاز": hero untouched; a dedicated tracker card below the list. */
export function Variant4() {
  return (
    <>
      <MockTopBar />
      <MockHero corners={2} />
      <MockPrayerGrid mode="icon" />
      <TrackerCard />
      <MockNextEvent />
    </>
  );
}
