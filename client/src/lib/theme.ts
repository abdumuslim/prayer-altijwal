// Theme manager (docs/V2_REDESIGN_SPEC.md Phase 1). A theme is a design-language
// skin: one `html[data-theme=X]` CSS block (styles/themes/*.css) overriding the
// palette tokens + the surface-recipe contract (styles/surfaces.css). This module
// owns the registry and the runtime switch; persistence lives in useSettings
// (prayer.app.v1.theme), and index.html stamps the attribute pre-paint.

import { isNative, PrayerAlarm } from "@/lib/native";

export type ThemeId = "night" | "glass" | "material" | "contrast";
export type FontScale = 1 | 1.125 | 1.25;

export interface ThemeMeta {
  id: ThemeId;
  /** i18n key for the gallery label — wired in Phase 7 after string approval. */
  nameKey: string;
  /** Dark background → light system-bar icons (and vice versa). */
  dark: boolean;
  /** PWA `theme-color` / native system-bar backdrop for this theme. */
  themeColor: string;
}

/** Registry — adding a theme = one CSS block + one entry here. */
export const THEMES: readonly ThemeMeta[] = [
  { id: "night", nameKey: "theme.night", dark: true, themeColor: "#06231f" },
  // themeColor values for the three v2 themes are finalized in Phase 7 with
  // their CSS; placeholders match each theme's intended page background.
  { id: "glass", nameKey: "theme.glass", dark: false, themeColor: "#e8eef5" },
  { id: "material", nameKey: "theme.material", dark: false, themeColor: "#f3f7f5" },
  { id: "contrast", nameKey: "theme.contrast", dark: true, themeColor: "#000000" },
] as const;

export const DEFAULT_THEME: ThemeId = "night";
export const DEFAULT_FONT_SCALE: FontScale = 1;

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

export function coerceTheme(raw: unknown): ThemeId {
  return typeof raw === "string" && THEME_IDS.has(raw) ? (raw as ThemeId) : DEFAULT_THEME;
}

export function coerceFontScale(raw: unknown): FontScale {
  return raw === 1.125 || raw === 1.25 ? raw : DEFAULT_FONT_SCALE;
}

export function themeMeta(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * Apply a theme at runtime: `data-theme` on <html> (drives every token/recipe),
 * the PWA theme-color meta, and — natively — the system-bar icon style +
 * AlarmActivity palette via the PrayerAlarm appearance bridge. Safe to call
 * before the plugin method exists (guarded catch).
 */
export function applyTheme(id: ThemeId): void {
  const meta = themeMeta(id);
  document.documentElement.dataset.theme = id;

  const metaTag = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (metaTag) metaTag.content = meta.themeColor;

  if (isNative()) {
    void PrayerAlarm.setAppearance({
      systemBarsLight: !meta.dark,
      bg: meta.themeColor,
    }).catch(() => {
      // Older shell without the method — theme still applies inside the WebView.
    });
  }
}

/** Apply the font-scale attribute (CSS: html[data-font-scale] font-size steps). */
export function applyFontScale(scale: FontScale): void {
  if (scale === 1) delete document.documentElement.dataset.fontScale;
  else document.documentElement.dataset.fontScale = String(scale);
}
