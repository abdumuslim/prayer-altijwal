// Next Islamic event, distributed horizontally across the row:
//   [icon · title]      <event name, centred>      [date / days-left]
// The payload carries no event date, so it's derived from daysLeft client-side
// (now + daysLeft days, formatted in the location's tz with Latin digits).

import { useI18n } from "@/i18n/I18nProvider";
import { EventIcon } from "@/components/ui/DynamicIcon";
import { localizeNumber } from "@/lib/format";
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

  // Gregorian date of the event = today + daysLeft (Latin digits, location tz).
  const eventDate = (() => {
    if (!tz) return "";
    try {
      return new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : "en", {
        timeZone: tz,
        day: "numeric",
        month: "short",
      }).format(new Date(now + event.daysLeft * 86_400_000));
    } catch {
      return "";
    }
  })();

  return (
    <div className="flex items-center justify-between gap-2">
      {/* start: icon + title */}
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-emerald/10 text-emerald">
          <EventIcon eventKey={event.key} className="size-4.5" />
        </span>
        <span className="text-xs font-medium text-ink-dim">{t("event.next")}</span>
      </div>

      {/* center: event name */}
      <span className="min-w-0 flex-1 truncate text-center text-sm font-bold text-ink">
        {localizedName}
      </span>

      {/* end: date over days-left chip, same column */}
      <div className="flex shrink-0 flex-col items-end gap-0.5 leading-tight">
        {eventDate && <span className="tnum text-[11px] text-ink-dim">{eventDate}</span>}
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
            (event.isToday ? "bg-gold/15 text-gold" : "bg-emerald/10 text-emerald")
          }
        >
          {chip}
        </span>
      </div>
    </div>
  );
}
