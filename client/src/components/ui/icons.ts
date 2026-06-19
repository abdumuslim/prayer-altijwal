// Unique lucide icon per prayer + per event, so every item in a set is visually
// distinct (design rule). Centralized so cards stay declarative.

import {
  Sunrise,
  Sun,
  CloudSun,
  Sunset,
  MoonStar,
  Moon,
  Star,
  Sparkles,
  CalendarHeart,
  Footprints,
  BookOpen,
  Gift,
  Mountain,
  Flame,
  type LucideIcon,
} from "lucide-react";
import type { EventKey, PrayerName } from "@/types/api";

export const PRAYER_ICONS: Record<PrayerName, LucideIcon> = {
  fajr: MoonStar, // pre-dawn — crescent + star
  sunrise: Sunrise, // sun cresting horizon
  dhuhr: Sun, // high midday sun
  asr: CloudSun, // softening afternoon
  maghrib: Sunset, // sun setting
  isha: Moon, // night
};

export const EVENT_ICONS: Record<EventKey, LucideIcon> = {
  islamicNewYear: Sparkles,
  ashura: Flame,
  mawlid: CalendarHeart,
  israMiraj: Footprints,
  midShaban: Star,
  ramadanStart: MoonStar,
  laylatAlQadr: Sparkles,
  eidAlFitr: Gift,
  arafah: Mountain,
  eidAlAdha: BookOpen,
};

export function eventIcon(key: string): LucideIcon {
  return (EVENT_ICONS as Record<string, LucideIcon>)[key] ?? CalendarHeart;
}
