// AR/EN segmented toggle. Shows the two languages in their own scripts so it
// reads correctly regardless of the active language.

import { Languages } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { Lang } from "@/types/api";

const OPTIONS: { lang: Lang; label: string }[] = [
  { lang: "ar", label: "العربية" },
  { lang: "en", label: "English" },
];

interface LanguageToggleProps {
  compact?: boolean;
}

export function LanguageToggle({ compact = false }: LanguageToggleProps) {
  const { lang, setLang } = useI18n();

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        className="grid size-11 place-items-center rounded-2xl border border-border-soft/70 bg-white/[0.03] text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-teal"
        aria-label="Toggle language"
      >
        <Languages className="size-4.5" />
      </button>
    );
  }

  return (
    <div className="inline-flex rounded-xl border border-border-soft bg-white/[0.03] p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.lang}
          type="button"
          onClick={() => setLang(o.lang)}
          className={cn(
            "rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
            lang === o.lang
              ? "bg-teal/15 text-teal"
              : "text-ink-dim hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
