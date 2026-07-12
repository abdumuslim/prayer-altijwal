// The native-only offline facade (loaded via loadNativeFacade in @/lib/native).
// Aggregates the engine-backed offline compute + alarm scheduler into one
// dynamically-imported chunk so the web bundle stays engine-free (amended hard
// rule 3). Type-checked by tsconfig.native.

export { computeLocalPrayerTimes } from "./local-times";
export { computeSchedule } from "./schedule";
export { computeLocalMonth } from "./month";
