// Settings slide-over: pick another city in your country (governorates),
// reminders, and language. The calculation method is auto-resolved by location
// and never surfaced.

import { Settings2, MapPin } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { SlideOver } from "@/components/ui/SlideOver";
import { LanguageToggle } from "@/components/LanguageToggle";
import { NotificationsOptIn } from "@/components/NotificationsOptIn";
import { GovernorateList } from "@/components/GovernorateList";
import { localizeCountry } from "@/lib/locale";
import type { StoredLocation } from "@/lib/storage";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  location: StoredLocation | null;
  onSelectLocation: (loc: StoredLocation) => void;
  push: UsePushSubscription;
}

export function SettingsPanel({
  open,
  onClose,
  location,
  onSelectLocation,
  push,
}: SettingsPanelProps) {
  const { t, lang } = useI18n();
  const country = location?.country ?? null;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      icon={<Settings2 className="size-5" />}
    >
      <div className="flex flex-col gap-7">
        {/* Other cities (governorates of the detected country) */}
        {country && (
          <section className="flex flex-col gap-2.5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <MapPin className="size-4 text-teal" />
              {t("settings.governoratesIn", { country: localizeCountry(country, lang) })}
            </h3>
            <GovernorateList
              country={country}
              onSelect={(loc) => {
                onSelectLocation(loc);
                onClose();
              }}
            />
          </section>
        )}

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
