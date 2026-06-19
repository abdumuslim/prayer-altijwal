// Single consolidated top row (replaces the old location bar + date card):
//   [settings] [time]      <location, centred>      [Hijri / Gregorian dates]
// GPS lives in the search panel now. Keeps the header to one row to save space.

import { Settings2, Clock } from "lucide-react";
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
    <header className="card flex items-center gap-2 px-3 py-2">
      {/* settings + current time */}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label={t("settings.title")}
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-ink-dim transition-colors hover:bg-white/10 hover:text-gold"
      >
        <Settings2 className="size-4" />
      </button>
      {time && (
        <span className="flex shrink-0 items-center gap-1 text-teal">
          <Clock className="size-3.5" />
          <span className="tnum text-sm font-bold text-ink">{time}</span>
        </span>
      )}

      {/* location — centred, opens search */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex min-w-0 flex-1 flex-col items-center leading-tight"
      >
        <span className="truncate text-sm font-semibold text-ink">{cityLabel}</span>
        {countryLabel && (
          <span className="truncate text-[10px] text-ink-dim">{countryLabel}</span>
        )}
      </button>

      {/* both dates */}
      {data && (
        <div className="flex shrink-0 flex-col items-end text-end leading-tight">
          <span className="text-[11px] font-bold text-gold">{data.hijriDate}</span>
          {gregorian && <span className="text-[10px] text-ink-dim">{gregorian}</span>}
        </div>
      )}
    </header>
  );
}
