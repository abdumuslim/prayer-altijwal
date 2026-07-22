// Bottom tab bar (v2 shell — docs/V2_REDESIGN_SPEC.md Phase 3; overlay since
// Phase 7). The bar's look is entirely theme-driven via the
// .tab-bar/.tab-item/.tab-pill surface recipes (night: docked frosted bar;
// glass: floating capsule; material: M3 pill indicator; contrast: ruled +
// inverted pill). The active pill wraps icon + label together (user-approved
// shape). ABSOLUTE overlay at the bottom of the relative h-dvh shell — pages
// span the full height and reserve --tabbar-clearance, so scrolling content
// passes visibly behind the bar (the glass capsule must refract real content,
// not empty background). Owns the bottom safe-area inset.

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

/** Tab ids in display order — the single source of truth the pager indexes by. */
export const TAB_IDS: TabId[] = TABS.map((t) => t.id);

interface TabBarProps {
  tab: TabId;
  onChange: (tab: TabId) => void;
}

export function TabBar({ tab, onChange }: TabBarProps) {
  const { t } = useI18n();
  return (
    <nav
      className="tab-bar absolute inset-x-0 bottom-0 z-40 px-2 pt-1"
      aria-label={t("nav.label")}
      // A DOCKED bar (night/material/contrast) paints behind the gesture area, so
      // its safe-area inset belongs INSIDE as padding. A FLOATING capsule (glass)
      // must sit above it instead — padding there just inflates the capsule with a
      // dead band under the items (user, 2026-07-22), so glass moves the inset to
      // margin-bottom via --tabbar-safe-* (surfaces.css).
      style={{ paddingBottom: "calc(0.375rem + var(--tabbar-safe-pad, var(--inset-bottom)))" }}
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
            {/* px-3, not px-4: at 360px the four Arabic labels overflowed their
                ~79px grid cells, so the pills leaned outward. */}
            <span className="tab-pill flex max-w-full flex-col items-center justify-center gap-1 px-3 py-1.5 transition-transform duration-150 active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100">
              {/* Icon+label sit well inside the 56px min-height, so bumping the
                  type does not grow the bar or change --tabbar-clearance. */}
              <Icon className="size-[21px]" strokeWidth={tab === id ? 2.4 : 2} />
              <span className="text-[12.5px] font-semibold leading-none">{t(labelKey)}</span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
