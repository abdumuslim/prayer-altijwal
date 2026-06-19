// Hijri date chip + Gregorian date, compact. Numerals localized.

import { Moon } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeDigits } from "@/lib/format";
import type { PrayerTimesResponse } from "@/types/api";

interface HijriDateProps {
  data: PrayerTimesResponse;
}

export function HijriDate({ data }: HijriDateProps) {
  const { lang } = useI18n();

  const gregorian = (() => {
    try {
      return new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: data.location.tz,
      }).format(new Date(data.now));
    } catch {
      return localizeDigits(data.date, lang);
    }
  })();

  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-gold/10 text-gold">
        <Moon className="size-4.5" />
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-bold text-gold">
          {localizeDigits(data.hijriDate, lang)}
        </span>
        <span className="text-xs text-ink-dim">{gregorian}</span>
      </div>
    </div>
  );
}
