// Settings slide-over: reminders and language. The location quick-pick lives in
// the search panel (opened from the location header), so it's not duplicated
// here. The calculation method is auto-resolved by location and never surfaced.

import { Settings2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { SlideOver } from "@/components/ui/SlideOver";
import { LanguageToggle } from "@/components/LanguageToggle";
import { NotificationsOptIn } from "@/components/NotificationsOptIn";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  push: UsePushSubscription;
}

export function SettingsPanel({ open, onClose, push }: SettingsPanelProps) {
  const { t } = useI18n();

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      icon={<Settings2 className="size-5" />}
    >
      <div className="flex flex-col gap-7">
        {/* Notifications */}
        <NotificationsOptIn push={push} />

        {/* Language */}
        <section className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{t("settings.language")}</h3>
          <LanguageToggle />
        </section>
      </div>
    </SlideOver>
  );
}
