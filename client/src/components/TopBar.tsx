// Single consolidated top row (replaces the old location bar + date card):
//   [time]      <location, centred>      [Hijri / Gregorian dates]
// GPS lives in the search panel; Settings is a bottom tab since the v2 shell
// (the gear button was retired — docs/V2_REDESIGN_SPEC.md Phase 3).

import { ChevronDown } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { gregorianFull } from "@/lib/gregorian";
import { storedCityName } from "@/lib/locale";
import type { PrayerTimesResponse } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

interface TopBarProps {
  location: StoredLocation | null;
  data: PrayerTimesResponse | null;
  now: number;
  resolving: boolean;
  onOpenSearch: () => void;
}

export function TopBar({
  location,
  data,
  now,
  resolving,
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
  const gregorian = tz ? gregorianFull(at, tz, lang) : "";

  const cityLabel =
    resolving && !location
      ? t("location.detecting")
      : location
        ? storedCityName(location, lang) || t("location.unknown")
        : t("location.unknown");

  return (
    <header className="card grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2">
      {/* start: current time (settings moved to the bottom tab bar) */}
      <div className="flex min-w-0 items-center justify-self-start">
        {time && (
          <span className="tnum shrink-0 text-2xl font-bold text-ink">{time}</span>
        )}
      </div>

      {/* center: location — truly centred (auto column between equal 1fr sides).
          The chevron + hover pill signal that it's tappable / changeable. */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={t("location.change")}
        className="hit-target group flex min-w-0 max-w-full flex-col items-center justify-self-center rounded-lg px-2 py-1 leading-tight transition-colors hover:bg-veil/5"
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-lg font-semibold text-ink">{cityLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-ink-dim transition-colors group-hover:text-gold" />
        </span>
      </button>

      {/* end: both dates — centred stacked column, sized up to fill the row */}
      {data ? (
        <div className="flex min-w-0 flex-col items-center justify-self-end leading-tight">
          <span className="truncate text-base font-bold text-gold">{data.hijriDate}</span>
          {gregorian && <span className="truncate text-sm text-ink-dim">{gregorian}</span>}
        </div>
      ) : (
        <span className="justify-self-end" />
      )}
    </header>
  );
}
