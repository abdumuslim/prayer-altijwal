// Frozen mock scenario for the design preview (DEV-only, throwaway).
// Thursday 2026-07-03, Baghdad, now = 15:53 — 6 min after the Asr adhan, so the
// richest possible state is visible at once: iqama bar running, a check-in
// actionable (Asr), two prayers already marked (Fajr=masjid, Dhuhr=home),
// rawatib half done, after-Asr adhkar + evening adhkar pending.

export const NOW = new Date(2026, 6, 3, 15, 53, 20).getTime();
const at = (d: number, h: number, m: number): number =>
  new Date(2026, 6, d, h, m).getTime();

export type CheckinState = "masjid" | "home" | "missed" | null;

export interface MockPrayer {
  name: "fajr" | "sunrise" | "dhuhr" | "asr" | "maghrib" | "isha";
  label: string;
  time: string;
  countdown?: string;
  passed: boolean;
  isNext?: boolean;
  /** undefined = never checkable (sunrise / not yet due). */
  checkin?: CheckinState;
}

export const PRAYERS: MockPrayer[] = [
  { name: "fajr", label: "الفجر", time: "3:35 ص", passed: true, checkin: "masjid" },
  { name: "sunrise", label: "الشروق", time: "5:06 ص", passed: true },
  { name: "dhuhr", label: "الظهر", time: "12:11 م", passed: true, checkin: "home" },
  { name: "asr", label: "العصر", time: "3:47 م", passed: true, checkin: null },
  { name: "maghrib", label: "المغرب", time: "7:16 م", countdown: "03 س:23 د", passed: false, isNext: true },
  { name: "isha", label: "العشاء", time: "8:46 م", countdown: "04 س:53 د", passed: false },
];

export const HERO = {
  nextLabel: "المغرب",
  countdown: "03 س:23 د",
  clock: "7:16 م",
  ringProgress: 0.971,
};

// Real IqamaBar props (fabricated timestamps — 9 min to iqama → urgent orange).
export const IQAMA = {
  prayer: "asr" as const,
  iqamaTs: at(3, 16, 2),
  blinking: false,
  msUntil: at(3, 16, 2) - NOW,
  progress: 0.6,
};

// Both windows inactive at 15:53 (Duha passed → counts to tomorrow's; Qiyam tonight).
export const DUHA = { active: false, target: at(4, 5, 26), msUntil: at(4, 5, 26) - NOW, progress: 0 };
export const QIYAM = { active: false, target: at(4, 0, 57), msUntil: at(4, 0, 57) - NOW, progress: 0 };

// Rawatib: fajr ✓(2) + before-dhuhr ✓(4) done; after-dhuhr skipped → 6/12 rakaat, 2/5 slots.
export const RAWATIB = { done: 6, total: 12, slotsDone: 2, slots: 5, nextLabel: "بعد المغرب" };

// Adhkar corner = the whole-day pair (morning ✓, evening pending) → 1/2; the
// arc also moves per dhikr item inside the open list (evening 0% here → 0.5).
// The sheet still lists all 7 (after-fajr ✓, after-dhuhr ✓, after-asr pending).
export const ADHKAR = { dailyDone: 1, dailyTotal: 2, progress: 0.5, done: 3, total: 7, pendingLabel: "المساء الآن" };

export const SCORE = { today: 11, max: 29, streak: 4, best: 27 };

export const WEEK = {
  values: [18, 22, 15, 26, 9, 24, 11],
  days: ["ج", "س", "أ", "ن", "ث", "ر", "خ"],
};
