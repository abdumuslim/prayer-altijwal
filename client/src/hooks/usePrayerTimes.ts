// The live-countdown engine. Fetches the prayer-times payload once per civil
// day / on change, then ticks a local setInterval(1000) recomputing each
// countdown from (timestamp - Date.now()) and re-deriving isNext/isPassed
// CLIENT-SIDE so the timer is smooth and never diverges from the server.
//
// Re-fetch on: location/method/asr change, local-midnight rollover, and tab
// refocus after >15min staleness. Exposes a proximity level for styling.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError, fetchPrayerTimes } from "@/lib/api";
import { proximityFromMs, type Proximity } from "@/lib/format";
import type {
  AsrMadhab,
  Lang,
  PrayerEntry,
  PrayerTimesResponse,
} from "@/types/api";
import type { StoredLocation } from "@/lib/storage";

const STALE_REFETCH_MS = 15 * 60_000;

export interface DerivedPrayer extends PrayerEntry {
  /** Live ms until this prayer (0 if passed). */
  msUntil: number;
}

export interface DerivedNext {
  name: string;
  label: string;
  time: string;
  timestamp: number;
  tomorrow: boolean;
  msUntil: number;
  /** Start of the current interval (previous prayer ts) for a progress ring. */
  intervalStart: number | null;
  proximity: Proximity;
}

export interface UsePrayerTimes {
  data: PrayerTimesResponse | null;
  /** Prayers with client-recomputed isPassed/isNext + msUntil, ticking live. */
  prayers: DerivedPrayer[];
  next: DerivedNext | null;
  loading: boolean;
  error: string | null;
  /** monotonically increasing each second — drives countdown re-renders. */
  now: number;
  refetch: () => void;
}

interface Params {
  location: StoredLocation | null;
  method: string | null;
  methodAuto: boolean;
  asr: AsrMadhab | null;
  lang: Lang;
}

/** Local civil-day key in a given IANA tz (YYYY-MM-DD). */
function localDayKey(tz: string, at: number = Date.now()): string {
  try {
    return new Date(at).toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return new Date(at).toLocaleDateString("en-CA");
  }
}

export function usePrayerTimes({
  location,
  method,
  methodAuto,
  asr,
  lang,
}: Params): UsePrayerTimes {
  const [data, setData] = useState<PrayerTimesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const lastFetchAt = useRef(0);
  const fetchedDayKey = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable dependency signature for re-fetch triggers.
  const sig = useMemo(() => {
    if (!location) return null;
    const effectiveMethod = methodAuto ? "auto" : method ?? "auto";
    return [
      location.lat.toFixed(4),
      location.lon.toFixed(4),
      location.tz,
      effectiveMethod,
      asr ?? "default",
      lang,
    ].join("|");
  }, [location, method, methodAuto, asr, lang]);

  const doFetch = useCallback(async () => {
    if (!location) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPrayerTimes(
        {
          lat: location.lat,
          lon: location.lon,
          tz: location.tz,
          method: methodAuto ? undefined : method ?? undefined,
          country: location.country ?? undefined,
          city: location.city ?? undefined,
          asr: asr ?? undefined,
          elevation: location.elevation ?? undefined,
          lang,
        },
        ac.signal,
      );
      setData(res);
      lastFetchAt.current = Date.now();
      fetchedDayKey.current = localDayKey(location.tz);
      setNow(Date.now());
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      const msg =
        err instanceof ApiRequestError
          ? err.message
          : "Failed to load prayer times";
      setError(msg);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [location, method, methodAuto, asr, lang]);

  // Fetch on signature change. This is the canonical data-fetching effect:
  // doFetch sets loading/error/data asynchronously (after an await), which is
  // exactly the "subscribe + setState in a callback" use the rule allows.
  useEffect(() => {
    if (!sig) return;
    // doFetch sets loading/data after an await (callback), not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void doFetch();
    return () => abortRef.current?.abort();
    // doFetch is derived from the same inputs as sig
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // 1s tick drives the live countdown + day-rollover + first-day refetch.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (location && fetchedDayKey.current) {
        const today = localDayKey(location.tz, t);
        if (today !== fetchedDayKey.current) {
          fetchedDayKey.current = today; // guard against repeat fires
          void doFetch();
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [location, doFetch]);

  // Re-fetch on tab refocus after staleness.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchAt.current > STALE_REFETCH_MS) void doFetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [doFetch]);

  // Client-side derivation each tick — never diverges from the server payload.
  const { prayers, next } = useMemo(() => {
    if (!data) return { prayers: [] as DerivedPrayer[], next: null as DerivedNext | null };

    const timed = data.prayers.map((p) => ({
      p,
      ts: p.timestamp,
    }));

    // Earliest upcoming with a timestamp.
    let upcomingIdx = -1;
    for (let i = 0; i < timed.length; i++) {
      const ts = timed[i].ts;
      if (ts != null && ts > now) {
        upcomingIdx = i;
        break;
      }
    }

    const derived: DerivedPrayer[] = timed.map(({ p, ts }, i) => {
      const isPassed = ts == null ? p.isPassed : ts <= now;
      const isNext = i === upcomingIdx;
      const msUntil = ts != null && ts > now ? ts - now : 0;
      return { ...p, isPassed, isNext, msUntil };
    });

    // Next: today's upcoming, else tomorrow's Fajr.
    let nextOut: DerivedNext | null = null;
    if (upcomingIdx >= 0) {
      const np = timed[upcomingIdx];
      const prevTs =
        upcomingIdx > 0 ? timed[upcomingIdx - 1].ts : null;
      const ts = np.ts!;
      const msUntil = Math.max(0, ts - now);
      nextOut = {
        name: np.p.name,
        label: np.p.label,
        time: np.p.time,
        timestamp: ts,
        tomorrow: false,
        msUntil,
        intervalStart: prevTs,
        proximity: proximityFromMs(msUntil),
      };
    } else if (data.tomorrowFajr != null) {
      const ts = data.tomorrowFajr;
      const msUntil = Math.max(0, ts - now);
      const lastTs = timed[timed.length - 1]?.ts ?? null;
      const fajr = data.prayers.find((p) => p.name === "fajr");
      nextOut = {
        name: "fajr",
        label: fajr?.label ?? "Fajr",
        time: fajr?.time ?? "",
        timestamp: ts,
        tomorrow: true,
        msUntil,
        intervalStart: lastTs,
        proximity: proximityFromMs(msUntil),
      };
    }

    return { prayers: derived, next: nextOut };
  }, [data, now]);

  return {
    data,
    prayers,
    next,
    loading,
    error,
    now,
    refetch: doFetch,
  };
}
