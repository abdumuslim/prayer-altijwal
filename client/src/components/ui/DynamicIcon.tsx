// Renders a looked-up event/prayer icon. Uses createElement so there is no
// capitalized JSX binding declared inside the component body (which the
// react-hooks rule would mistake for a nested component definition).

import { createElement } from "react";
import { eventIcon, PRAYER_ICONS } from "@/components/ui/icons";
import type { PrayerName } from "@/types/api";

interface EventIconProps {
  eventKey: string;
  className?: string;
}

export function EventIcon({ eventKey, className }: EventIconProps) {
  return createElement(eventIcon(eventKey), { className });
}

interface PrayerIconProps {
  name: PrayerName;
  className?: string;
}

export function PrayerIcon({ name, className }: PrayerIconProps) {
  return createElement(PRAYER_ICONS[name], { className });
}
