// Top bar: current city ("Nearest: X" semantics from reverse geocode), the
// active method chip (shows "Auto" when following detection), GPS + settings
// affordances. Tapping the method chip opens settings.

import { MapPin, Settings2, Navigation, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { StringKey } from "@/i18n/strings.en";
import { cn } from "@/lib/utils";
import type { MethodInfo } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

interface LocationBarProps {
  location: StoredLocation | null;
  method: MethodInfo | null;
  resolving: boolean;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onUseGps: () => void;
}

export function LocationBar({
  location,
  method,
  resolving,
  onOpenSettings,
  onOpenSearch,
  onUseGps,
}: LocationBarProps) {
  const { t } = useI18n();

  const cityLabel = (() => {
    if (resolving && !location) return t("location.detecting");
    if (!location) return t("location.unknown");
    return location.city ?? t("location.unknown");
  })();

  const methodLabel = (() => {
    if (!method) return t("chip.method");
    if (method.auto) return t("chip.auto");
    const key = `method.${method.key}` as StringKey;
    const translated = t(key);
    return translated === key ? method.label : translated;
  })();

  return (
    <header className="flex items-center gap-2">
      {/* City — opens search */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-border-soft/70 bg-white/[0.03] px-3.5 py-2.5 text-start transition-colors hover:bg-white/[0.06]"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal/10 text-teal">
          <MapPin className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-ink">
            {cityLabel}
          </span>
          {method && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings();
              }}
              className={cn(
                "flex w-fit items-center gap-1 text-[11px] font-medium",
                method.auto ? "text-emerald" : "text-gold",
              )}
            >
              <span className="size-1.5 rounded-full bg-current" />
              {methodLabel}
            </button>
          )}
        </span>
        <Search className="ms-auto size-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink-dim" />
      </button>

      <button
        type="button"
        onClick={onUseGps}
        aria-label={t("location.useGps")}
        className="grid size-11 shrink-0 place-items-center rounded-2xl border border-border-soft/70 bg-white/[0.03] text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-teal"
      >
        <Navigation className={cn("size-4.5", resolving && "animate-spin-slow")} />
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label={t("settings.title")}
        className="grid size-11 shrink-0 place-items-center rounded-2xl border border-border-soft/70 bg-white/[0.03] text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-gold"
      >
        <Settings2 className="size-4.5" />
      </button>
    </header>
  );
}
