// Settings section: opt-in worship features. Five on/off switches, all off by
// default — this is the entry point for the otherwise-hidden hero widgets
// (Duha/Qiyam satellites, rawatib/adhkar rings, and the check-in + points +
// history record). Persists via useSettings.setFeature. Turning a switch off
// only hides the widget; the recorded worship log is preserved.

import {
  BookOpen,
  MoonStar,
  Repeat,
  Sparkles,
  SunMedium,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Toggle } from "@/components/ui/Toggle";
import type { WorshipFeatures, WorshipFeatureKey } from "@/lib/storage";
import type { StringKey } from "@/i18n/strings.en";

interface FeatureRow {
  key: WorshipFeatureKey;
  icon: LucideIcon;
  color: string;
  labelKey: StringKey;
}

const FEATURE_ROWS: FeatureRow[] = [
  { key: "duha", icon: SunMedium, color: "text-amber", labelKey: "worship.feature.duha" },
  { key: "qiyam", icon: MoonStar, color: "text-indigo", labelKey: "worship.feature.qiyam" },
  { key: "rawatib", icon: Repeat, color: "text-sky", labelKey: "worship.feature.rawatib" },
  { key: "adhkar", icon: BookOpen, color: "text-teal", labelKey: "worship.feature.adhkar" },
  { key: "record", icon: Trophy, color: "text-gold", labelKey: "worship.feature.record" },
];

interface WorshipSettingsProps {
  features: WorshipFeatures;
  onChange: (key: WorshipFeatureKey, on: boolean) => void;
}

export function WorshipSettings({ features, onChange }: WorshipSettingsProps) {
  const { t } = useI18n();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-emerald/10 text-emerald">
          <Sparkles className="size-4.5" />
        </span>
        <div className="flex flex-col leading-tight">
          <h3 className="text-sm font-bold text-ink">{t("worship.settings.title")}</h3>
          <span className="text-xs text-ink-dim">{t("worship.settings.subtitle")}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {FEATURE_ROWS.map(({ key, icon: Icon, color, labelKey }) => {
          const labelId = `worship-feature-${key}`;
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-xl border border-border-soft/70 bg-white/[0.02] px-3 py-2"
            >
              <Icon className={`size-4 shrink-0 ${color}`} />
              <span id={labelId} className="min-w-0 flex-1 truncate text-sm text-ink">
                {t(labelKey)}
              </span>
              <Toggle
                checked={features[key]}
                onChange={(on) => onChange(key, on)}
                labelId={labelId}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
