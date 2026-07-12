// Appearance section for the Settings tab (docs/V2_REDESIGN_SPEC.md Phase 7
// gallery, pulled forward): the theme gallery (design-language skins) + the
// font-size control. Selecting applies instantly (useSettings.setTheme /
// setFontScale persist + stamp <html>).

import { Check } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { THEMES, type FontScale, type ThemeId } from "@/lib/theme";
import type { StringKey } from "@/i18n/strings.en";
import { cn } from "@/lib/utils";

interface AppearanceSettingsProps {
  theme: ThemeId;
  onChangeTheme: (id: ThemeId) => void;
  fontScale: FontScale;
  onChangeFontScale: (scale: FontScale) => void;
}

/** Mini scene+card+accent preview painted per theme (static — the gallery must
    show every theme's look regardless of the active one). */
const SWATCHES: Record<ThemeId, { bg: string; card: string; border: string; dots: string[] }> = {
  night: {
    bg: "linear-gradient(160deg,#06231f,#04181a)",
    card: "rgba(14,58,54,0.7)",
    border: "rgba(22,80,74,0.8)",
    dots: ["#f5c451", "#2dd4bf", "#34d399"],
  },
  glass: {
    bg: "linear-gradient(160deg,#cfe0f4,#e5edf8)",
    card: "rgba(255,255,255,0.5)",
    border: "rgba(255,255,255,0.9)",
    dots: ["#b07a10", "#0b9488", "#0a9469"],
  },
  material: {
    bg: "#0f1513",
    card: "#1c2320",
    border: "#262d2a",
    dots: ["#e6c36c", "#80d5c8", "#5bc98f"],
  },
  contrast: {
    bg: "#000000",
    card: "#0d0d0d",
    border: "#6e807c",
    dots: ["#ffd54a", "#5eead4", "#6ee7b7"],
  },
};

const FONT_SCALES: { value: FontScale; labelKey: StringKey }[] = [
  { value: 1, labelKey: "fontSize.normal" },
  { value: 1.125, labelKey: "fontSize.large" },
  { value: 1.25, labelKey: "fontSize.xlarge" },
];

export function AppearanceSettings({
  theme,
  onChangeTheme,
  fontScale,
  onChangeFontScale,
}: AppearanceSettingsProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3">
      {/* Theme gallery */}
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map(({ id, nameKey }) => {
          const s = SWATCHES[id];
          const active = theme === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChangeTheme(id)}
              aria-pressed={active}
              className={cn(
                "flex flex-col gap-2 rounded-2xl border p-2.5 text-start transition-colors",
                active
                  ? "border-gold/70 bg-veil/[0.06]"
                  : "border-border-soft/60 bg-veil/[0.02]",
              )}
            >
              <span
                className="block h-14 overflow-hidden rounded-xl p-1.5"
                style={{ background: s.bg }}
              >
                <span
                  className="flex h-full flex-col justify-between rounded-lg p-1.5"
                  style={{ background: s.card, border: `1px solid ${s.border}` }}
                >
                  <span
                    className="block h-1.5 w-1/2 rounded-full"
                    style={{ background: s.dots[0] }}
                  />
                  <span className="flex gap-1">
                    {s.dots.map((d) => (
                      <span key={d} className="size-2 rounded-full" style={{ background: d }} />
                    ))}
                  </span>
                </span>
              </span>
              <span className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-ink">{t(nameKey as StringKey)}</span>
                {active && <Check className="size-4 text-gold" />}
              </span>
            </button>
          );
        })}
      </div>

      {/* Font size */}
      <div>
        <p className="mb-1.5 text-[13px] font-semibold text-ink-dim">{t("settings.fontSize")}</p>
        <div className="flex gap-1 rounded-2xl border border-border-soft/60 bg-veil/[0.02] p-1">
          {FONT_SCALES.map(({ value, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChangeFontScale(value)}
              aria-pressed={fontScale === value}
              className={cn(
                "flex-1 rounded-xl py-2 text-center text-[13px] font-semibold transition-colors",
                fontScale === value ? "bg-gold/15 text-gold" : "text-ink-dim",
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
