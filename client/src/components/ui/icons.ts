// Unique lucide icon per prayer, so every prayer in a set is visually distinct
// (design rule). Used by the reminder/alert prayer picker; centralized so
// callers stay declarative.

import {
  Sunrise,
  Sun,
  SunMedium,
  CloudSun,
  CloudMoon,
  Sunset,
  MoonStar,
  Moon,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { AlertTarget, PrayerName } from "@/types/api";

export const PRAYER_ICONS: Record<PrayerName, LucideIcon> = {
  fajr: MoonStar, // pre-dawn — crescent + star
  sunrise: Sunrise, // sun cresting horizon
  dhuhr: Sun, // high midday sun
  asr: CloudSun, // softening afternoon
  maghrib: Sunset, // sun setting
  isha: Moon, // night
};

// Icon per reminder target: the five fard reuse PRAYER_ICONS; the sunnah/adhkar
// targets get their own distinct glyphs (duha matches the hero Duha satellite;
// qiyam avoids fajr's MoonStar; morning/evening adhkar read as sunrise/night).
export const ALERT_TARGET_ICONS: Record<AlertTarget, LucideIcon> = {
  fajr: PRAYER_ICONS.fajr,
  dhuhr: PRAYER_ICONS.dhuhr,
  asr: PRAYER_ICONS.asr,
  maghrib: PRAYER_ICONS.maghrib,
  isha: PRAYER_ICONS.isha,
  duha: SunMedium,
  qiyam: Sparkles,
  adhkar_morning: Sunrise,
  adhkar_evening: CloudMoon,
};
