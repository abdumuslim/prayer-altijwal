// Curated Iraqi governorate capitals for the location quick-pick.
//
// Why curated (not the generic most-populous-per-adm1 heuristic): for a few
// governorates the GeoNames metro/district feature outranks the real seat, so
// the heuristic surfaced wrong/ugly names — "Al Mawsil al Jadidah" (new) and
// "Al Basrah al Qadimah" (old) instead of Mosul/Basra, "Khanaqin" instead of
// the Diyala capital Baqubah, "Bayji" instead of Tikrit, plus the small
// Halabja governorate the product does not want listed. This fixed 18-row
// table (Halabja intentionally omitted) is an Iraq calibration analogous to
// the BaghdadYMA method profile: the generic algorithm still serves every
// other country. Coordinates / elevation are taken from the dataset's clean
// city entries; Arabic names are normalized (Karbala كربلاء, Samawah السماوة,
// Ramadi الرمادي) rather than the dataset's noisy alternates.
//
// Reverse-geocoding and city search are unaffected — Halabja, Khanaqin and the
// "new/old" districts all remain in cities15000.json and stay searchable; only
// the governorate quick-pick is curated. See docs/GEOCODING.md.

import type { City } from "./cities-index.js";

/** The 18 governorate capitals, one per admin-1 division (excludes Halabja). */
export const IQ_GOVERNORATE_CAPITALS: readonly City[] = [
  { n: "Baghdad", a: "Baghdad", lat: 33.34058, lon: 44.40088, cc: "IQ", adm1: "07", pop: 7216000, tz: "Asia/Baghdad", ele: 41, nar: "بغداد" },
  { n: "Mosul", a: "Mosul", lat: 36.335, lon: 43.11889, cc: "IQ", adm1: "15", pop: 1683000, tz: "Asia/Baghdad", ele: 228, nar: "الموصل" },
  { n: "Erbil", a: "Erbil", lat: 36.19117, lon: 44.00943, cc: "IQ", adm1: "11", pop: 1612700, tz: "Asia/Baghdad", ele: 429, nar: "أربيل" },
  { n: "Basra", a: "Basra", lat: 30.50852, lon: 47.7804, cc: "IQ", adm1: "02", pop: 1326564, tz: "Asia/Baghdad", ele: 4, nar: "البصرة" },
  { n: "Karbala", a: "Karbala", lat: 32.61603, lon: 44.02488, cc: "IQ", adm1: "12", pop: 1218732, tz: "Asia/Baghdad", ele: 32, nar: "كربلاء" },
  { n: "Kirkuk", a: "Kirkuk", lat: 35.46806, lon: 44.39222, cc: "IQ", adm1: "13", pop: 1031000, tz: "Asia/Baghdad", ele: 346, nar: "كركوك" },
  { n: "Sulaymaniyah", a: "Sulaymaniyah", lat: 35.56496, lon: 45.4329, cc: "IQ", adm1: "05", pop: 878146, tz: "Asia/Baghdad", ele: 847, nar: "السليمانية" },
  { n: "Nasiriyah", a: "Nasiriyah", lat: 31.05799, lon: 46.25726, cc: "IQ", adm1: "09", pop: 558400, tz: "Asia/Baghdad", ele: 7, nar: "الناصرية" },
  { n: "Najaf", a: "Najaf", lat: 32.02594, lon: 44.34625, cc: "IQ", adm1: "17", pop: 482576, tz: "Asia/Baghdad", ele: 41, nar: "النجف" },
  { n: "Hillah", a: "Hillah", lat: 32.46367, lon: 44.41963, cc: "IQ", adm1: "06", pop: 455700, tz: "Asia/Baghdad", ele: 33, nar: "الحلة" },
  { n: "Dohuk", a: "Dohuk", lat: 36.86608, lon: 42.9879, cc: "IQ", adm1: "08", pop: 340900, tz: "Asia/Baghdad", ele: 510, nar: "دهوك" },
  { n: "Amarah", a: "Amarah", lat: 31.83561, lon: 47.14483, cc: "IQ", adm1: "14", pop: 323302, tz: "Asia/Baghdad", ele: 10, nar: "العمارة" },
  { n: "Diwaniyah", a: "Diwaniyah", lat: 31.99289, lon: 44.92552, cc: "IQ", adm1: "04", pop: 318801, tz: "Asia/Baghdad", ele: 25, nar: "الديوانية" },
  { n: "Kut", a: "Kut", lat: 32.5128, lon: 45.81817, cc: "IQ", adm1: "16", pop: 315162, tz: "Asia/Baghdad", ele: 22, nar: "الكوت" },
  { n: "Ramadi", a: "Ramadi", lat: 33.42056, lon: 43.30778, cc: "IQ", adm1: "01", pop: 223500, tz: "Asia/Baghdad", ele: 53, nar: "الرمادي" },
  { n: "Samawah", a: "Samawah", lat: 31.33198, lon: 45.2944, cc: "IQ", adm1: "03", pop: 152890, tz: "Asia/Baghdad", ele: 15, nar: "السماوة" },
  { n: "Baqubah", a: "Baqubah", lat: 33.75403, lon: 44.60518, cc: "IQ", adm1: "10", pop: 152550, tz: "Asia/Baghdad", ele: 48, nar: "بعقوبة" },
  { n: "Tikrit", a: "Tikrit", lat: 34.61581, lon: 43.67861, cc: "IQ", adm1: "18", pop: 42477, tz: "Asia/Baghdad", ele: 112, nar: "تكريت" },
];
