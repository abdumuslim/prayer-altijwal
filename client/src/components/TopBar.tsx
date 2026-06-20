// Single consolidated top row (replaces the old location bar + date card):
//   [settings] [time]      <location, centred>      [Hijri / Gregorian dates]
// GPS lives in the search panel now. Keeps the header to one row to save space.

import { Settings2, Clock, ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeCountry, storedCityName } from "@/lib/locale";
import type { PrayerTimesResponse } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

interface TopBarProps {
  location: StoredLocation | null;
  data: PrayerTimesResponse | null;
  now: number;
  resolving: boolean;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
}

export function TopBar({
  location,
  data,
  now,
  resolving,
  onOpenSettings,
  onOpenSearch,
}: TopBarProps) {
  const { t, lang } = useI18n();
  const tz = location?.tz;
  const at = new Date(now);

  const fmt = (opts: Intl.DateTimeFormatOptions): string => {
    if (!tz) return "";
    try {
      return new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : "en", {
        timeZone: tz,
        ...opts,
      }).format(at);
    } catch {
      return "";
    }
  };

  const time = fmt({ hour: "numeric", minute: "2-digit", hour12: true });
  const gregorian = fmt({ weekday: "long", day: "numeric", month: "long" });

  const cityLabel =
    resolving && !location
      ? t("location.detecting")
      : location
        ? storedCityName(location, lang) || t("location.unknown")
        : t("location.unknown");
  const countryLabel = location ? localizeCountry(location.country, lang) : "";

  return (
    <header className="card grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
      {/* start: settings + current time (time sized up to fill the row height) */}
      <div className="flex min-w-0 items-center gap-2 justify-self-start">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t("settings.title")}
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-ink-dim transition-colors hover:bg-white/10 hover:text-gold"
        >
          <Settings2 className="size-4" />
        </button>
        {time && (
          <span className="flex shrink-0 items-center gap-1.5 text-teal">
            <Clock className="size-4" />
            <span className="tnum text-xl font-bold text-ink">{time}</span>
          </span>
        )}
      </div>

      {/* center: location — truly centred (auto column between equal 1fr sides).
          The chevron + hover pill signal that it's tappable / changeable. */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t("location.change")}
        className="group flex min-w-0 max-w-full flex-col items-center justify-self-center rounded-lg px-2 py-1 leading-tight transition-colors hover:bg-white/5"
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-base font-semibold text-ink">{cityLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-dim transition-colors group-hover:text-gold" />
        </span>
        {countryLabel && (
          <span className="truncate text-[11px] text-ink-dim">{countryLabel}</span>
        )}
      </button>

      {/* end: both dates — centred stacked column, sized up to fill the row */}
      {data ? (
        <div className="flex min-w-0 flex-col items-center justify-self-end leading-tight">
          <span className="truncate text-sm font-bold text-gold">{data.hijriDate}</span>
          {gregorian && <span className="truncate text-xs text-ink-dim">{gregorian}</span>}
        </div>
      ) : (
        <span className="justify-self-end" />
      )}
    </header>
  );
}
