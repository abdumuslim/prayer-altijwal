// Debounced forward city search (~300ms). Results list → select → persist via
// the onSelect callback (which feeds useLocation.setLocation).

import { useEffect, useRef, useState } from "react";
import { MapPin, Search, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useDebounce } from "@/hooks/useDebounce";
import { searchCities } from "@/lib/api";
import { localizeNumber } from "@/lib/format";
import { SlideOver } from "@/components/ui/SlideOver";
import type { CityResult } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

interface CitySearchProps {
  open: boolean;
  onClose: () => void;
  onSelect: (loc: StoredLocation) => void;
}

export function CitySearch({ open, onClose, onSelect }: CitySearchProps) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CityResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const debounced = useDebounce(query.trim(), 300);
  const inputRef = useRef<HTMLInputElement>(null);
  const acRef = useRef<AbortController | null>(null);

  // Reset the search UI to a clean slate each time the panel opens, and focus
  // the input. These resets synchronize the panel to the external `open` prop.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTouched(false);
      const id = window.setTimeout(() => inputRef.current?.focus(), 120);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Debounced search-fetch effect: results/loading are set from the resolved
  // promise (a callback); the short-query reset clears stale results.
  useEffect(() => {
    acRef.current?.abort();
    if (debounced.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    acRef.current = ac;
    setLoading(true);
    setTouched(true);
    void searchCities(debounced, lang, ac.signal)
      .then((res) => {
        if (!ac.signal.aborted) setResults(res.results ?? []);
      })
      .catch(() => {
        if (!ac.signal.aborted) setResults([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [debounced, lang]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const pick = (c: CityResult) => {
    onSelect({
      city: c.name,
      country: c.country,
      tz: c.tz,
      lat: c.lat,
      lon: c.lon,
      elevation: c.elevation,
    });
    onClose();
  };

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={t("search.title")}
      icon={<Search className="size-5" />}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5 rounded-2xl border border-border-soft bg-white/[0.04] px-3.5 py-2.5 focus-within:border-teal/50">
          <Search className="size-4.5 shrink-0 text-ink-dim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <Loader2 className="size-4 shrink-0 animate-spin text-teal" />}
        </div>

        {!touched && (
          <p className="px-1 py-6 text-center text-sm text-ink-faint">
            {t("search.hint")}
          </p>
        )}

        {touched && !loading && results.length === 0 && debounced.length >= 2 && (
          <p className="px-1 py-6 text-center text-sm text-ink-faint">
            {t("search.noResults")}
          </p>
        )}

        <ul className="flex flex-col gap-1.5">
          {results.map((c, i) => (
            <li key={`${c.name}-${c.lat}-${c.lon}-${i}`}>
              <button
                type="button"
                onClick={() => pick(c)}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent bg-white/[0.02] px-3 py-2.5 text-start transition-colors hover:border-teal/30 hover:bg-white/[0.06]"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal/10 text-teal">
                  <MapPin className="size-4" />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-semibold text-ink">
                    {c.name}
                  </span>
                  <span className="truncate text-xs text-ink-dim">
                    {[c.admin1, c.country].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {c.population != null && c.population > 0 && (
                  <span className="ms-auto shrink-0 text-[11px] text-ink-faint">
                    {localizeNumber(Math.round(c.population / 1000), lang)}K
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </SlideOver>
  );
}
