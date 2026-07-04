// Settings state: calculation method (+ auto flag), Asr madhab, language.
// Persists to the versioned localStorage envelope. Language itself is owned by
// I18nProvider; this hook exposes method/asr/auto and mirrors language for
// convenience in the subscribe payload.

import { useCallback, useState } from "react";
import { loadState, patchState } from "@/lib/storage";
import type {
  IqamaMinutes,
  IqamaPrayer,
  WorshipFeatures,
  WorshipFeatureKey,
} from "@/lib/storage";
import type { AsrMadhab } from "@/types/api";

export interface SettingsState {
  /** User-chosen method key when not auto; null means "use detected". */
  method: string | null;
  /** Follow country auto-detection. */
  methodAuto: boolean;
  /** User-chosen Asr madhab; null means "method default". */
  asr: AsrMadhab | null;
  /** Per-prayer adhan→iqama durations in minutes. */
  iqamaMinutes: IqamaMinutes;
  /** Opt-in worship features (all off by default). */
  features: WorshipFeatures;
}

export interface UseSettings extends SettingsState {
  setMethod: (key: string) => void;
  resetMethodToAuto: () => void;
  setAsr: (asr: AsrMadhab) => void;
  setIqama: (prayer: IqamaPrayer, minutes: number) => void;
  setFeature: (key: WorshipFeatureKey, on: boolean) => void;
}

export function useSettings(): UseSettings {
  const [state, setState] = useState<SettingsState>(() => {
    const s = loadState();
    return {
      method: s.method,
      methodAuto: s.methodAuto,
      asr: s.asr,
      iqamaMinutes: s.iqamaMinutes,
      features: s.features,
    };
  });

  const setMethod = useCallback((key: string) => {
    setState((prev) => ({ ...prev, method: key, methodAuto: false }));
    patchState({ method: key, methodAuto: false });
  }, []);

  const resetMethodToAuto = useCallback(() => {
    setState((prev) => ({ ...prev, method: null, methodAuto: true }));
    patchState({ method: null, methodAuto: true });
  }, []);

  const setAsr = useCallback((asr: AsrMadhab) => {
    setState((prev) => ({ ...prev, asr }));
    patchState({ asr });
  }, []);

  const setIqama = useCallback((prayer: IqamaPrayer, minutes: number) => {
    const clamped = Math.max(0, Math.min(60, Math.round(minutes)));
    setState((prev) => {
      const next = { ...prev.iqamaMinutes, [prayer]: clamped };
      patchState({ iqamaMinutes: next });
      return { ...prev, iqamaMinutes: next };
    });
  }, []);

  const setFeature = useCallback((key: WorshipFeatureKey, on: boolean) => {
    setState((prev) => {
      const next = { ...prev.features, [key]: on };
      patchState({ features: next });
      return { ...prev, features: next };
    });
  }, []);

  return { ...state, setMethod, resetMethodToAuto, setAsr, setIqama, setFeature };
}
