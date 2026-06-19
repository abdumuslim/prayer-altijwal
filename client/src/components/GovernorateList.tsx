// The detected country's governorates (admin-1 capitals) as a quick-pick list.
// Replaces the old manual calculation-method override: tapping one sets the
// location (the method is auto-resolved server-side and never shown).

import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { fetchGovernorates } from "@/lib/api";
import { cityDisplayName } from "@/lib/locale";
import type { GovernorateResult } from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

interface GovernorateListProps {
  country: string | null;
  onSelect: (loc: StoredLocation) => void;
}

export function GovernorateList({ country, onSelect }: GovernorateListProps) {
  const { lang } = useI18n();
  const [items, setItems] = useState<GovernorateResult[]>([]);
  const [loading, setLoading] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => {
    acRef.current?.abort();
    if (!country) {
      setItems([]);
      return;
    }
    const ac = new AbortController();
    acRef.current = ac;
    setLoading(true);
    void fetchGovernorates(country, ac.signal)
      .then((res) => {
        if (!ac.signal.aborted) setItems(res.governorates ?? []);
      })
      .catch(() => {
        if (!ac.signal.aborted) setItems([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [country]);

  const pick = (g: GovernorateResult) => {
    onSelect({
      city: g.name,
      cityAr: g.nameAr,
      country: g.country,
      tz: g.tz,
      lat: g.lat,
      lon: g.lon,
      elevation: g.elevation,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-ink-faint">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {items.map((g) => (
        <li key={`${g.admin1}-${g.lat}`}>
          <button
            type="button"
            onClick={() => pick(g)}
            className="flex w-full items-center gap-2 rounded-xl border border-transparent bg-white/[0.02] px-3 py-2.5 text-start transition-colors hover:border-teal/30 hover:bg-white/[0.06]"
          >
            <MapPin className="size-3.5 shrink-0 text-teal" />
            <span className="truncate text-sm font-medium text-ink">
              {cityDisplayName(g.name, g.nameAr, lang)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
