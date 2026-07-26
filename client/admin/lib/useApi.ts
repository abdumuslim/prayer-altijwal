import { useCallback, useEffect, useRef, useState } from "react";
import { AdminApiError } from "./api";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetch-on-mount with optional polling. A 401 is swallowed here: the api module
 * already told the shell to show the login screen, and surfacing "Unauthorized"
 * in every panel at the same moment is just noise.
 */
export function useApi<T>(fetcher: () => Promise<T>, refreshMs?: number): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  // Keeps the effect from re-running when a caller passes an inline arrow.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const result = await fetcherRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof AdminApiError && err.status === 401) return;
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    if (!refreshMs) return () => {
      cancelled = true;
    };

    const timer = window.setInterval(run, refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tick, refreshMs]);

  return { data, error, loading, reload };
}
