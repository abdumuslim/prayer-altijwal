// Bottom tab bar (v2 shell — docs/V2_REDESIGN_SPEC.md Phase 3). The bar's
// look is entirely theme-driven via the .tab-bar/.tab-item/.tab-pill surface
// recipes (night: docked frosted bar; glass: floating capsule; material: M3
// pill indicator; contrast: ruled + inverted pill). The active pill wraps
// icon + label together (user-approved shape). In-flow (not fixed) at the
// bottom of the h-dvh shell; owns the bottom safe-area inset.

import { CalendarClock, ChartColumnBig, House, Settings2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { StringKey } from "@/i18n/strings.en";

export type TabId = "home" | "times" | "reports" | "settings";

const TABS: { id: TabId; labelKey: StringKey; icon: typeof House }[] = [
  { id: "home", labelKey: "nav.home", icon: House },
  { id: "times", labelKey: "nav.times", icon: CalendarClock },
  { id: "reports", labelKey: "nav.reports", icon: ChartColumnBig },
  { id: "settings", labelKey: "nav.settings", icon: Settings2 },
];

interface TabBarProps {
  tab: TabId;
  onChange: (tab: TabId) => void;
}

export function TabBar({ tab, onChange }: TabBarProps) {
  const { t } = useI18n();
  return (
    <nav
      className="tab-bar z-40 shrink-0 px-2 pt-1"
      aria-label={t("nav.home")}
      style={{ paddingBottom: "calc(0.25rem + var(--safe-area-inset-bottom, 0px))" }}
    >
      <div className="mx-auto grid w-full max-w-xl grid-cols-4">
        {TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={tab === id ? "page" : undefined}
            className="tab-item flex min-h-14 items-center justify-center"
          >
            <span className="tab-pill flex flex-col items-center justify-center gap-1 px-4 py-1.5">
              <Icon className="size-[19px]" strokeWidth={tab === id ? 2.4 : 2} />
              <span className="text-[11px] font-semibold leading-none">{t(labelKey)}</span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
