// Next Islamic event: localized name + days-left chip. Compact, single row.

import { useI18n } from "@/i18n/I18nProvider";
import { EventIcon } from "@/components/ui/DynamicIcon";
import { localizeNumber } from "@/lib/format";
import type { StringKey } from "@/i18n/strings.en";
import type { NextEvent as NextEventData } from "@/types/api";

interface NextEventProps {
  event: NextEventData | null;
}

export function NextEvent({ event }: NextEventProps) {
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

  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-xl bg-emerald/10 text-emerald">
        <EventIcon eventKey={event.key} className="size-4.5" />
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-bold text-ink">{localizedName}</span>
        <span className="text-xs text-ink-dim">{t("event.upcoming")}</span>
      </div>
      <span
        className={
          "ms-auto shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " +
          (event.isToday
            ? "bg-gold/15 text-gold"
            : "bg-emerald/10 text-emerald")
        }
      >
        {chip}
      </span>
    </div>
  );
}
