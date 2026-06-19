// Lightweight in-house i18n: two flat dicts + t() + context. No heavy library.
// On language change, sets document.documentElement.lang and dir. Default: ar.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type StringKey } from "@/i18n/strings.en";
import { ar } from "@/i18n/strings.ar";
import type { Lang } from "@/types/api";
import { patchState } from "@/lib/storage";

const DICTS: Record<Lang, Record<StringKey, string>> = { en, ar };

export type TFunction = (
  key: StringKey,
  vars?: Record<string, string | number>,
) => string;

interface I18nContextValue {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function applyDocument(lang: Lang): void {
  const dir = lang === "ar" ? "rtl" : "ltr";
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    name in vars ? String(vars[name]) : m,
  );
}

interface I18nProviderProps {
  initialLang: Lang;
  children: ReactNode;
}

export function I18nProvider({ initialLang, children }: I18nProviderProps) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    applyDocument(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    patchState({ language: next });
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === "ar" ? "en" : "ar";
      patchState({ language: next });
      return next;
    });
  }, []);

  const t = useCallback<TFunction>(
    (key, vars) => {
      const dict = DICTS[lang];
      const template = dict[key] ?? en[key] ?? key;
      return interpolate(template, vars);
    },
    [lang],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ lang, dir: lang === "ar" ? "rtl" : "ltr", setLang, toggleLang, t }),
    [lang, setLang, toggleLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
