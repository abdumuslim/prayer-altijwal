// Monthly-table data for the المواقيت tab (docs/V2_REDESIGN_SPEC.md Phase 5).
// Web: one GET /api/prayer-times/month per (location, month), cached in-memory
// for the session. Native: computed fully offline via the engine facade (the
// same buildMonthPayload the server runs — parity by construction). Fetches
// lazily: nothing loads until the tab is first shown (`active`).

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMonthTimes } from "@/lib/api";
import { isNative, loadNativeFacade } from "@/lib/native";
import type { StoredLocation } from "@/lib/storage";
import type { AsrMadhab, Lang, MonthTimesResponse } from "@/types/api";

interface UseMonthTimesInput {
  location: StoredLocation | null;
  lang: Lang;
  method: string | null;
  methodAuto: boolean;
  asr: AsrMadhab | null;
  /** The Times tab is visible (pages are keep-mounted — gate work on this). */
  active: boolean;
}

export interface UseMonthTimes {
  data: MonthTimesResponse | null;
  loading: boolean;
  error: string | null;
  /** Displayed month, YYYY-MM (location-tz current month by default). */
  monthKey: string;
  isCurrentMonth: boolean;
  prevMonth: () => void;
  nextMonth: () => void;
  resetMonth: () => void;
}

/** Current civil month (YYYY-MM) in the location tz. */
function currentMonthKey(tz: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .slice(0, 7);
  } catch {
    return new Date().toISOString().slice(0, 7);
  }
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function useMonthTimes(input: UseMonthTimesInput): UseMonthTimes {
  const { location, lang, method, methodAuto, asr, active } = input;
  const current = currentMonthKey(location?.tz);
  const [monthKey, setMonthKey] = useState(current);
  const [data, setData] = useState<MonthTimesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session cache — regenerable data, so memory-only (no localStorage).
  const cache = useRef(new Map<string, MonthTimesResponse>());

  const locSig = location
    ? `${location.lat.toFixed(4)},${location.lon.toFixed(4)},${location.tz},${methodAuto ? "auto" : method},${asr ?? ""}`
    : null;

  // Location change → snap back to its current month.
  useEffect(() => {
    setMonthKey(currentMonthKey(location?.tz));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locSig]);

  useEffect(() => {
    if (!active || !location || !locSig) return;
    const key = `${locSig}|${monthKey}|${lang}`;
    const hit = cache.current.get(key);
    if (hit) {
      setData(hit);
      setError(null);
      return;
    }

    const abort = new AbortController();
    setLoading(true);
    setError(null);

    const load = async (): Promise<MonthTimesResponse> => {
      if (isNative()) {
        const facade = await loadNativeFacade();
        if (!facade) throw new Error("native facade unavailable");
        // Structural match with the server response (parity-tested).
        return facade.computeLocalMonth({
          location,
          lang,
          method,
          methodAuto,
          asr,
          month: monthKey,
        }) as unknown as MonthTimesResponse;
      }
      return fetchMonthTimes(
        {
          lat: location.lat,
          lon: location.lon,
          tz: location.tz,
          method: methodAuto ? undefined : method ?? undefined,
          country: location.country ?? undefined,
          city: location.city ?? undefined,
          asr: asr ?? undefined,
          month: monthKey,
          elevation: location.elevation ?? undefined,
          lang,
        },
        abort.signal,
      );
    };

    load()
      .then((res) => {
        cache.current.set(key, res);
        setData(res);
      })
      .catch((e: unknown) => {
        if (abort.signal.aborted) return;
        setError(e instanceof Error ? e.message : "failed");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });

    return () => abort.abort();
  }, [active, locSig, monthKey, lang, location, method, methodAuto, asr]);

  const prevMonth = useCallback(() => setMonthKey((k) => shiftMonth(k, -1)), []);
  const nextMonth = useCallback(() => setMonthKey((k) => shiftMonth(k, 1)), []);
  const resetMonth = useCallback(
    () => setMonthKey(currentMonthKey(location?.tz)),
    [location?.tz],
  );

  return {
    data,
    loading,
    error,
    monthKey,
    isCurrentMonth: monthKey === current,
    prevMonth,
    nextMonth,
    resetMonth,
  };
}
