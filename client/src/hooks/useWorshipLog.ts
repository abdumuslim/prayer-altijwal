// The one stateful module of the worship tracker. Thin shell over the tested
// pure lib functions (worship-log/-windows/-storage/-stats): owns the
// WorshipState, persists to the isolated `prayer.worship.v1` envelope, and
// re-derives everything from the ticking `now` supplied by usePrayerTimes —
// no timers of its own. Day identity is the civil date in the LOCATION's tz.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localDayKey } from "@/lib/civil-day";
import { ADHKAR_LISTS, slotComplete } from "@/lib/adhkar-data";
import {
  applyMark,
  emptyDayLog,
  type AdhkarSlot,
  type DayKey,
  type DayLog,
  type WorshipMark,
  type WorshipState,
} from "@/lib/worship-log";
import {
  compact,
  loadWorshipState,
  saveWorshipState,
} from "@/lib/worship-storage";
import { canMark as canMarkWindow, isEditableDay } from "@/lib/worship-windows";
import { deriveStats, type WorshipStats } from "@/lib/worship-stats";
import type { PrayerName } from "@/types/api";

/** Dhikr taps come in bursts (33×+) — debounce their persistence. */
const DHIKR_SAVE_DEBOUNCE_MS = 500;

interface Params {
  /** The LOCATION's IANA tz (never the device tz); null until resolved. */
  tz: string | null;
  prayers: { name: PrayerName; timestamp: number | null }[];
  /** The 1s tick from usePrayerTimes — drives day rollover + window gates. */
  now: number;
}

export interface UseWorshipLog {
  todayKey: DayKey;
  today: DayLog;
  stats: WorshipStats;
  canMark: (mark: WorshipMark) => boolean;
  /** Apply a mark to today. Silently ignored while its window is closed. */
  mark: (mark: WorshipMark) => void;
  dhikrProgress: WorshipState["dhikrProgress"];
  /**
   * Record tap progress for one dhikr item (debounced persist; flushed on
   * pagehide). Auto-marks the slot's adhkar done when the list completes.
   */
  setDhikrCount: (slot: AdhkarSlot, itemIndex: number, count: number) => void;
}

export function useWorshipLog({ tz, prayers, now }: Params): UseWorshipLog {
  const [state, setState] = useState<WorshipState>(loadWorshipState);

  // tz ?? "" → localDayKey falls back to the device tz until a location
  // resolves (the app defaults to Baghdad immediately, so this is transient).
  const todayKey = useMemo(() => localDayKey(tz ?? "", now), [tz, now]);

  // Debounced persistence for dhikr-tap bursts; everything else saves eagerly.
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<WorshipState | null>(null);

  const flushSave = useCallback(() => {
    if (saveTimer.current != null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingSave.current) {
      saveWorshipState(pendingSave.current);
      pendingSave.current = null;
    }
  }, []);

  const saveDebounced = useCallback(
    (next: WorshipState) => {
      pendingSave.current = next;
      if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flushSave, DHIKR_SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  // A backgrounded/discarded tab must not lose an in-flight dhikr count.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onHide);
      flushSave();
    };
  }, [flushSave]);

  // Rollover/compaction: on mount and whenever the civil day flips, fold
  // days past the retention horizon and drop stale dhikr progress.
  useEffect(() => {
    setState((s) => {
      const next = compact(s, todayKey);
      saveWorshipState(next);
      return next;
    });
  }, [todayKey]);

  const today = useMemo(
    () => state.days[todayKey] ?? emptyDayLog(tz ?? ""),
    [state.days, todayKey, tz],
  );

  const stats = useMemo(() => deriveStats(state, todayKey), [state, todayKey]);

  const canMark = useCallback(
    (mark: WorshipMark): boolean =>
      isEditableDay(todayKey, tz ?? "", now) && canMarkWindow(mark, prayers, now),
    [todayKey, tz, now, prayers],
  );

  const mark = useCallback(
    (m: WorshipMark): void => {
      if (!canMark(m)) return;
      setState((s) => {
        const day = s.days[todayKey] ?? emptyDayLog(tz ?? "");
        const next: WorshipState = {
          ...s,
          days: { ...s.days, [todayKey]: applyMark(day, m) },
        };
        saveWorshipState(next);
        return next;
      });
    },
    [canMark, todayKey, tz],
  );

  const setDhikrCount = useCallback(
    (slot: AdhkarSlot, itemIndex: number, count: number): void => {
      setState((s) => {
        const prev = s.dhikrProgress[slot];
        const counts =
          prev && prev.dayKey === todayKey ? [...prev.counts] : [];
        counts[itemIndex] = Math.max(0, Math.floor(count));
        const items = ADHKAR_LISTS[slot];
        const done = slotComplete(counts, items);

        const day = s.days[todayKey] ?? emptyDayLog(tz ?? "");
        const next: WorshipState = {
          ...s,
          days:
            done && !day.adhkar[slot]
              ? { ...s.days, [todayKey]: applyMark(day, { kind: "adhkar", slot, done: true }) }
              : s.days,
          dhikrProgress: { ...s.dhikrProgress, [slot]: { dayKey: todayKey, counts } },
        };
        // Completion is a milestone — persist it eagerly; taps are debounced.
        if (done) {
          saveWorshipState(next);
        } else {
          saveDebounced(next);
        }
        return next;
      });
    },
    [todayKey, tz, saveDebounced],
  );

  return {
    todayKey,
    today,
    stats,
    canMark,
    mark,
    dhikrProgress: state.dhikrProgress,
    setDhikrCount,
  };
}
