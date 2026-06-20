// Unique lucide icon per prayer, so every prayer in a set is visually distinct
// (design rule). Used by the reminder/alert prayer picker; centralized so
// callers stay declarative.

import {
  Sunrise,
  Sun,
  CloudSun,
  Sunset,
  MoonStar,
  Moon,
  type LucideIcon,
} from "lucide-react";
import type { PrayerName } from "@/types/api";

export const PRAYER_ICONS: Record<PrayerName, LucideIcon> = {
  fajr: MoonStar, // pre-dawn — crescent + star
  sunrise: Sunrise, // sun cresting horizon
  dhuhr: Sun, // high midday sun
  asr: CloudSun, // softening afternoon
  maghrib: Sunset, // sun setting
  isha: Moon, // night
};
