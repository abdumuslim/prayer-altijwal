// Settings section: per-prayer adhan→iqama durations (minutes). One stepper row
// per obligatory prayer (sunrise has no iqama). Persists via useSettings.setIqama.

import { Minus, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { localizeNumber } from "@/lib/format";
import { DEFAULT_IQAMA_MINUTES } from "@/lib/storage";
import type { IqamaMinutes, IqamaPrayer } from "@/lib/storage";
import type { StringKey } from "@/i18n/strings.en";

const IQAMA_PRAYERS = Object.keys(DEFAULT_IQAMA_MINUTES) as IqamaPrayer[];

interface IqamaSettingsProps {
  iqamaMinutes: IqamaMinutes;
  onChange: (prayer: IqamaPrayer, minutes: number) => void;
}

export function IqamaSettings({ iqamaMinutes, onChange }: IqamaSettingsProps) {
  const { t, lang } = useI18n();

  return (
    <div className="flex flex-col gap-2">
        {IQAMA_PRAYERS.map((name) => {
          const Icon = PRAYER_ICONS[name];
          const val = iqamaMinutes[name];
          return (
            <div
              key={name}
              className="flex items-center gap-2 rounded-xl border border-border-soft/70 bg-white/[0.02] px-3 py-2"
            >
              <Icon className="size-4 shrink-0 text-teal" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {t(`prayer.${name}` as StringKey)}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={t("iqama.decrease")}
                  onClick={() => onChange(name, val - 1)}
                  disabled={val <= 0}
                  className="grid size-7 place-items-center rounded-lg border border-border-soft bg-white/[0.03] text-ink-dim transition-colors hover:text-teal disabled:opacity-40"
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="tnum w-16 text-center text-sm font-semibold text-ink">
                  {t("iqama.minutes", { min: localizeNumber(val, lang) })}
                </span>
                <button
                  type="button"
                  aria-label={t("iqama.increase")}
                  onClick={() => onChange(name, val + 1)}
                  disabled={val >= 60}
                  className="grid size-7 place-items-center rounded-lg border border-border-soft bg-white/[0.03] text-ink-dim transition-colors hover:text-teal disabled:opacity-40"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
}
