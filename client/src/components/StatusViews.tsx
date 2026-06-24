// Friendly loading / error / location-needed states. Never a white screen.

import { Loader2, WifiOff, RotateCw, MapPinOff, Compass } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="card flex min-h-[260px] flex-col items-center justify-center gap-3 p-8 text-center">
      <Loader2 className="size-7 animate-spin text-teal" />
      <p className="text-base text-ink-dim">{t("loading.times")}</p>
    </div>
  );
}

interface FetchErrorStateProps {
  message?: string;
  onRetry: () => void;
}

export function FetchErrorState({ message, onRetry }: FetchErrorStateProps) {
  const { t } = useI18n();
  return (
    <div className="card flex min-h-[220px] flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-imminent/10 text-imminent">
        <WifiOff className="size-6" />
      </span>
      <p className="text-base text-ink-dim">{message ?? t("error.fetch")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-deep to-emerald px-5 py-2.5 text-base font-semibold text-night-2 transition hover:brightness-110"
      >
        <RotateCw className="size-4" />
        {t("error.retry")}
      </button>
    </div>
  );
}

interface LocationNeededStateProps {
  denied: boolean;
  onUseGps: () => void;
  onSearch: () => void;
}

export function LocationNeededState({
  denied,
  onUseGps,
  onSearch,
}: LocationNeededStateProps) {
  const { t } = useI18n();
  return (
    <div className="card flex min-h-[260px] flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-teal/10 text-teal">
        <MapPinOff className="size-6" />
      </span>
      <p className="max-w-xs text-base text-ink-dim">
        {denied ? t("error.locationDenied") : t("location.set")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {!denied && (
          <button
            type="button"
            onClick={onUseGps}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-deep to-emerald px-4 py-2.5 text-base font-semibold text-night-2 transition hover:brightness-110"
          >
            <Compass className="size-4" />
            {t("location.useGps")}
          </button>
        )}
        <button
          type="button"
          onClick={onSearch}
          className="rounded-xl border border-border-soft bg-white/[0.03] px-4 py-2.5 text-base font-semibold text-ink transition hover:bg-white/[0.06]"
        >
          {t("search.title")}
        </button>
      </div>
    </div>
  );
}
