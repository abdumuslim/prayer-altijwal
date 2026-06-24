// Next Islamic event, distributed horizontally across the row:
//   [label]      <event name, centred>      [Hijri date / days-left]
// The payload carries no event date, so it's derived from daysLeft client-side
// (now + daysLeft days, rendered in the Hijri calendar in the location's tz).

import { useI18n } from "@/i18n/I18nProvider";
import { localizeNumber } from "@/lib/format";
import { hijriDayMonth } from "@/lib/hijri";
import type { StringKey } from "@/i18n/strings.en";
import type { NextEvent as NextEventData } from "@/types/api";

interface NextEventProps {
  event: NextEventData | null;
  now: number;
  tz?: string | null;
}

export function NextEvent({ event, now, tz }: NextEventProps) {
  const { t, lang } = useI18n();
  if (!event) return null;

  const localizedName = (() => {
    const key = `event.${event.key}` as StringKey;
    const translated = t(key);
    return translated === key ? event.name : translated;
  })();

  const chip = event.isToday
    ? t("event.today")
    : event.daysLeft === 1
      ? t("event.inDay")
      : t("event.inDays", { days: localizeNumber(event.daysLeft, lang) });

  // Hijri date of the event = today + daysLeft (Umm al-Qura, location tz).
  const eventDate = tz
    ? hijriDayMonth(new Date(now + event.daysLeft * 86_400_000), tz, lang)
    : "";

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      {/* start: label */}
      <div className="flex min-w-0 items-center gap-2 justify-self-start">
        <span className="truncate text-sm font-medium text-ink-dim">{t("event.next")}</span>
      </div>

      {/* center: event name — truly centred (auto column between equal 1fr sides) */}
      <span className="min-w-0 justify-self-center truncate text-center text-base font-bold text-ink">
        {localizedName}
      </span>

      {/* end: date over days-left chip — centred stacked column */}
      <div className="flex min-w-0 flex-col items-center justify-self-end gap-0.5 leading-tight">
        {eventDate && <span className="tnum text-[13px] text-ink-dim">{eventDate}</span>}
        <span
          className={
            "rounded-full px-2 py-0.5 text-[13px] font-semibold " +
            (event.isToday ? "bg-gold/15 text-gold" : "bg-emerald/10 text-emerald")
          }
        >
          {chip}
        </span>
      </div>
    </div>
  );
}
