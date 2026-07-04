// Settings slide-over: reminders + iqama timing. The location quick-pick lives
// in the search panel (opened from the location header), so it's not duplicated
// here. The calculation method is auto-resolved by location and never surfaced,
// and the UI is locked to Arabic (no language picker — see main.tsx).

import { Settings2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { SlideOver } from "@/components/ui/SlideOver";
import { NotificationsOptIn } from "@/components/NotificationsOptIn";
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
}

export function SettingsPanel({
  open,
  onClose,
  push,
  iqamaMinutes,
  onChangeIqama,
  features,
  onChangeFeature,
}: SettingsPanelProps) {
  const { t } = useI18n();

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      icon={<Settings2 className="size-5" />}
    >
      <div className="flex flex-col gap-7">
        {/* Worship features (opt-in) — first, so the hidden widgets are findable */}
        <WorshipSettings features={features} onChange={onChangeFeature} />

        {/* Notifications */}
        <NotificationsOptIn push={push} />

        {/* Iqama timing */}
        <IqamaSettings iqamaMinutes={iqamaMinutes} onChange={onChangeIqama} />
      </div>
    </SlideOver>
  );
}
