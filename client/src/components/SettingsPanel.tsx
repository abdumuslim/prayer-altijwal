// Settings slide-over: reminders + iqama timing. The location quick-pick lives
// in the search panel (opened from the location header), so it's not duplicated
// here. The calculation method is auto-resolved by location and never surfaced,
// and the UI is locked to Arabic (no language picker — see main.tsx).

import { BellRing, Settings2, Sparkles, Timer } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { SlideOver } from "@/components/ui/SlideOver";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { NotificationsOptIn } from "@/components/NotificationsOptIn";
import { AlarmSoundPicker } from "@/components/AlarmSoundPicker";
import { IqamaSettings } from "@/components/IqamaSettings";
import { WorshipSettings } from "@/components/WorshipSettings";
import type {
  IqamaMinutes,
  IqamaPrayer,
  WorshipFeatures,
  WorshipFeatureKey,
} from "@/lib/storage";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  push: UsePushSubscription;
  iqamaMinutes: IqamaMinutes;
  onChangeIqama: (prayer: IqamaPrayer, minutes: number) => void;
  features: WorshipFeatures;
  onChangeFeature: (key: WorshipFeatureKey, on: boolean) => void;
  alarmSound: string;
  onChangeAlarmSound: (id: string) => void;
}

export function SettingsPanel({
  open,
  onClose,
  push,
  iqamaMinutes,
  onChangeIqama,
  features,
  onChangeFeature,
  alarmSound,
  onChangeAlarmSound,
}: SettingsPanelProps) {
  const { t } = useI18n();

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      icon={<Settings2 className="size-5" />}
    >
      <div className="flex flex-col gap-3">
        {/* Collapsible sections — all collapsed by default so the panel opens as a
            compact list of headers. Worship features first (entry to the hidden
            widgets), then reminders, then iqama timing. */}
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
          <NotificationsOptIn push={push} />
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
      </div>
    </SlideOver>
  );
}
