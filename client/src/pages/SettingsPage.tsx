// الإعدادات tab (v2 shell — docs/V2_REDESIGN_SPEC.md Phase 3): the old
// SettingsPanel slide-over content as a real page (the SlideOver wrapper is
// retired), plus the About row surfacing the app semver (__APP_VERSION__).
// Phase 7 adds the theme gallery section.

import { BellRing, Info, Palette, Sparkles, Timer } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { AppearanceSettings } from "@/components/AppearanceSettings";
import { NotificationsOptIn } from "@/components/NotificationsOptIn";
import { NativeReminders } from "@/components/NativeReminders";
import { AlarmSoundPicker } from "@/components/AlarmSoundPicker";
import { isNative } from "@/lib/native";
import { IqamaSettings } from "@/components/IqamaSettings";
import { WorshipSettings } from "@/components/WorshipSettings";
import type { ThemeId } from "@/lib/theme";
import type {
  IqamaMinutes,
  IqamaPrayer,
  WorshipFeatures,
  WorshipFeatureKey,
} from "@/lib/storage";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";

interface SettingsPageProps {
  push: UsePushSubscription;
  iqamaMinutes: IqamaMinutes;
  onChangeIqama: (prayer: IqamaPrayer, minutes: number) => void;
  features: WorshipFeatures;
  onChangeFeature: (key: WorshipFeatureKey, on: boolean) => void;
  alarmSound: string;
  onChangeAlarmSound: (id: string) => void;
  theme: ThemeId;
  onChangeTheme: (id: ThemeId) => void;
}

export function SettingsPage({
  push,
  iqamaMinutes,
  onChangeIqama,
  features,
  onChangeFeature,
  alarmSound,
  onChangeAlarmSound,
  theme,
  onChangeTheme,
}: SettingsPageProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3">
      {/* Appearance first — the v2 headline feature (theme gallery + font size). */}
      <CollapsibleSection
        icon={<Palette className="size-4.5" />}
        iconClass="bg-indigo/10 text-indigo"
        title={t("settings.theme")}
        subtitle={t("settings.themeSubtitle")}
      >
        <AppearanceSettings theme={theme} onChangeTheme={onChangeTheme} />
      </CollapsibleSection>

      {/* Collapsible sections — same order/content as the old panel. */}
      <CollapsibleSection
        icon={<Sparkles className="size-4.5" />}
        iconClass="bg-emerald/10 text-emerald"
        title={t("worship.settings.title")}
        subtitle={t("worship.settings.subtitle")}
      >
        <WorshipSettings features={features} onChange={onChangeFeature} />
      </CollapsibleSection>

      <CollapsibleSection
        icon={<BellRing className="size-4.5" />}
        iconClass="bg-gold/10 text-gold"
        title={t("notify.title")}
        subtitle={t("notify.subtitle")}
      >
        {isNative() ? <NativeReminders /> : <NotificationsOptIn push={push} />}
        <AlarmSoundPicker selected={alarmSound} onSelect={onChangeAlarmSound} />
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Timer className="size-4.5" />}
        iconClass="bg-teal/10 text-teal"
        title={t("iqama.title")}
        subtitle={t("iqama.subtitle")}
      >
        <IqamaSettings iqamaMinutes={iqamaMinutes} onChange={onChangeIqama} />
      </CollapsibleSection>

      {/* About — the semver source of truth, baked in at build time. */}
      <section className="card flex items-center justify-between px-3.5 py-3">
        <span className="flex items-center gap-2 text-sm text-ink-dim">
          <Info className="size-4 text-ink-faint" />
          {t("settings.version")}
        </span>
        <span className="tnum text-sm font-bold text-ink">{__APP_VERSION__}</span>
      </section>
    </div>
  );
}
