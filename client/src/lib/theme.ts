// Theme manager (docs/V2_REDESIGN_SPEC.md Phase 1). A theme is a design-language
// skin: one `html[data-theme=X]` CSS block (styles/themes/*.css) overriding the
// palette tokens + the surface-recipe contract (styles/surfaces.css). This module
// owns the registry and the runtime switch; persistence lives in useSettings
// (prayer.app.v1.theme), and index.html stamps the attribute pre-paint.

import { isNative, PrayerAlarm } from "@/lib/native";

export type ThemeId = "night" | "glass" | "material" | "contrast";

export interface ThemeMeta {
  id: ThemeId;
  /** i18n key for the gallery label — wired in Phase 7 after string approval. */
  nameKey: string;
  /** Dark background → light system-bar icons (and vice versa). */
  dark: boolean;
  /** PWA `theme-color` / native system-bar backdrop for this theme. */
  themeColor: string;
  /**
   * Native AlarmActivity palette (Phase 7) — persisted on-device by
   * setAppearance/AppearanceStore so the full-screen alarm follows the theme
   * even app-killed. Values mirror the theme CSS: --color-night / --color-ink /
   * --color-ink-dim / the theme's alarm accent (gold family).
   */
  alarm: { bg: string; ink: string; inkDim: string; accent: string };
}

/** Registry — adding a theme = one CSS block + one entry here. */
export const THEMES: readonly ThemeMeta[] = [
  {
    id: "night",
    nameKey: "theme.night",
    dark: true,
    themeColor: "#06231f",
    alarm: { bg: "#04181A", ink: "#EAFAF6", inkDim: "#8FB3AD", accent: "#F5C451" },
  },
  {
    id: "glass",
    nameKey: "theme.glass",
    dark: false,
    themeColor: "#dbe7f5",
    alarm: { bg: "#dfe9f6", ink: "#10263a", inkDim: "#3f5d75", accent: "#b07a10" },
  },
  // material = M3 DARK scheme (fidelity round 2) — system bars follow.
  {
    id: "material",
    nameKey: "theme.material",
    dark: true,
    themeColor: "#0f1513",
    alarm: { bg: "#0f1513", ink: "#dee4e0", inkDim: "#bcc9c4", accent: "#e6c36c" },
  },
  {
    id: "contrast",
    nameKey: "theme.contrast",
    dark: true,
    themeColor: "#000000",
    alarm: { bg: "#000000", ink: "#ffffff", inkDim: "#d5dedb", accent: "#ffd54a" },
  },
] as const;

export const DEFAULT_THEME: ThemeId = "night";

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

export function coerceTheme(raw: unknown): ThemeId {
  return typeof raw === "string" && THEME_IDS.has(raw) ? (raw as ThemeId) : DEFAULT_THEME;
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
      alarm: meta.alarm,
    }).catch(() => {
      // Older shell without the method — theme still applies inside the WebView.
    });
  }
}
