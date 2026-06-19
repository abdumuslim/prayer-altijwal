// The device's reminder rules (multiple independent alerts). Keyed by the push
// endpoint; CRUD goes straight to the server (the source of truth for what the
// scheduler fires). Mirrors the home project's alert model.

import { useCallback, useEffect, useState } from "react";
import {
  createAlert,
  deleteAlert,
  listAlerts,
  updateAlert,
} from "@/lib/api";
import type { AlertInput, PrayerAlert } from "@/types/api";

export interface UsePrayerAlerts {
  alerts: PrayerAlert[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  create: (input: Omit<AlertInput, "endpoint">) => Promise<void>;
  update: (id: number, input: Omit<AlertInput, "endpoint">) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export function usePrayerAlerts(endpoint: string | null): UsePrayerAlerts {
  const [alerts, setAlerts] = useState<PrayerAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!endpoint) {
      setAlerts([]);
      return;
    }
    setLoading(true);
    setError(null);
    listAlerts(endpoint)
      .then((res) => setAlerts(res.alerts))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load reminders"),
      )
      .finally(() => setLoading(false));
  }, [endpoint]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (input: Omit<AlertInput, "endpoint">) => {
      if (!endpoint) return;
      const { alert } = await createAlert({ ...input, endpoint });
      setAlerts((prev) => [...prev, alert]);
    },
    [endpoint],
  );

  const update = useCallback(
    async (id: number, input: Omit<AlertInput, "endpoint">) => {
      if (!endpoint) return;
      const { alert } = await updateAlert(id, { ...input, endpoint });
      setAlerts((prev) => prev.map((a) => (a.id === id ? alert : a)));
    },
    [endpoint],
  );

  const remove = useCallback(
    async (id: number) => {
      if (!endpoint) return;
      await deleteAlert(id, endpoint);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    },
    [endpoint],
  );

  return { alerts, loading, error, reload, create, update, remove };
}
