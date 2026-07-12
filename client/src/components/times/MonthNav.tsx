// Month navigator for the monthly table: prev/next chevrons around the month
// title (Gregorian + Hijri month names from the loaded payload) + a reset chip
// when browsing away from the current month.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeDigits } from "@/lib/format";
import { LEVANTINE_MONTHS_AR } from "@/lib/gregorian";
import { cn } from "@/lib/utils";
import type { MonthTimesResponse } from "@/types/api";

interface MonthNavProps {
  monthKey: string;
  data: MonthTimesResponse | null;
  isCurrentMonth: boolean;
  onPrev: () => void;
  onNext: () => void;
  onReset: () => void;
}

/** Gregorian month title. Arabic uses the Levantine/Iraqi month set (تموز…)
    like the header date, never Intl's transliterated يوليو set. */
function gregorianTitle(monthKey: string, lang: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (lang === "ar") return `${LEVANTINE_MONTHS_AR[m - 1] ?? ""} ${y}`;
  const d = new Date(Date.UTC(y, m - 1, 15));
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Hijri month(s) spanned by the loaded table, e.g. "محرم–صفر 1448". */
function hijriRange(data: MonthTimesResponse | null, lang: string): string | null {
  if (!data || data.days.length === 0) return null;
  const first = data.days[0];
  const last = data.days[data.days.length - 1];
  const months =
    first.hijriMonth === last.hijriMonth
      ? first.hijriMonth
      : `${first.hijriMonth}–${last.hijriMonth}`;
  return localizeDigits(`${months} ${last.hijriYear}`, lang === "ar" ? "ar" : "en");
}

export function MonthNav({ monthKey, data, isCurrentMonth, onPrev, onNext, onReset }: MonthNavProps) {
  const { t, lang } = useI18n();
  const hijri = hijriRange(data, lang);

  return (
    <div className="flex items-center justify-between gap-2">
      {/* RTL: "previous" moves back in time → visually to the right (start). */}
      <NavBtn label={t("times.prevMonth")} onClick={onPrev}>
        <ChevronRight className="size-4 rtl:block ltr:hidden" />
        <ChevronLeft className="size-4 rtl:hidden ltr:block" />
      </NavBtn>

      <div className="flex min-w-0 flex-col items-center leading-tight">
        <span className="tnum truncate text-[13px] font-bold text-ink">
          {gregorianTitle(monthKey, lang)}
        </span>
        {hijri && <span className="tnum truncate text-[11px] text-ink-dim">{hijri}</span>}
      </div>

      <div className="flex items-center gap-1">
        {!isCurrentMonth && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-semibold text-gold"
          >
            {t("times.thisMonth")}
          </button>
        )}
        <NavBtn label={t("times.nextMonth")} onClick={onNext}>
          <ChevronLeft className="size-4 rtl:block ltr:hidden" />
          <ChevronRight className="size-4 rtl:hidden ltr:block" />
        </NavBtn>
      </div>
    </div>
  );
}

function NavBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl border border-border-soft/60",
        "bg-veil/[0.03] text-ink-dim transition-colors hover:text-gold",
      )}
    >
      {children}
    </button>
  );
}
