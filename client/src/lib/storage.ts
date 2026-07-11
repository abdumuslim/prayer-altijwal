// Versioned localStorage envelope with safe migration. All persisted client
// state lives under a single key as { v: 1, ... } so future schema changes can
// migrate forward without corrupting older data.

import type { AsrMadhab, Lang } from "@/types/api";
import { DEFAULT_ALARM_SOUND, isSelectableToneId } from "@/lib/alarm-sounds";

const STORAGE_KEY = "prayer.app.v1";
const CURRENT_VERSION = 1 as const;

export interface StoredLocation {
  city: string | null;
  /** Arabic-script city name when known (shown in Arabic mode). */
  cityAr?: string | null;
  country: string | null;
  tz: string;
  lat: number;
  lon: number;
  elevation: number | null;
}

export interface ReminderPrefs {
  enabled: boolean;
  /** Lead times in minutes before each prayer; 0 = at the prayer time. */
  leadMinutes: number[];
  prayers: string[];
}

/**
 * Default minutes between each prayer's adhan and its iqama. Keyed by the five
 * obligatory prayers only — sunrise has no iqama, so it is intentionally absent.
 */
export const DEFAULT_IQAMA_MINUTES = {
  fajr: 25,
  dhuhr: 15,
  asr: 15,
  maghrib: 5,
  isha: 10,
} as const;

/** The five prayers that have an iqama (excludes "sunrise"). */
export type IqamaPrayer = keyof typeof DEFAULT_IQAMA_MINUTES;
export type IqamaMinutes = Record<IqamaPrayer, number>;

/**
 * Opt-in worship features. All off by default — a fresh user sees only the core
 * prayer times, and turns on exactly what they want in Settings. `record` gates
 * the whole gamification unit (fard check-in + score pill + stats/history);
 * the other four gate their own hero widget. Toggling off only hides the UI —
 * the underlying `prayer.worship.v1` log is untouched, so history survives.
 */
export interface WorshipFeatures {
  duha: boolean;
  qiyam: boolean;
  rawatib: boolean;
  adhkar: boolean;
  record: boolean;
}

export type WorshipFeatureKey = keyof WorshipFeatures;

export const DEFAULT_WORSHIP_FEATURES: WorshipFeatures = {
  duha: false,
  qiyam: false,
  rawatib: false,
  adhkar: false,
  record: false,
};

export interface AppState {
  v: typeof CURRENT_VERSION;
  location: StoredLocation | null;
  method: string | null;
  /** When true, the method follows country auto-detection. */
  methodAuto: boolean;
  asr: AsrMadhab | null;
  language: Lang | null;
  reminderPrefs: ReminderPrefs;
  /** Per-prayer adhan→iqama durations in minutes. */
  iqamaMinutes: IqamaMinutes;
  /** Opt-in worship features (all off by default). */
  features: WorshipFeatures;
  /** Selected alarm tone id (see lib/alarm-sounds). */
  alarmSound: string;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: false,
  leadMinutes: [10],
  prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
};

export const DEFAULT_STATE: AppState = {
  v: CURRENT_VERSION,
  location: null,
  method: null,
  methodAuto: true,
  asr: null,
  language: null,
  reminderPrefs: DEFAULT_REMINDER_PREFS,
  iqamaMinutes: { ...DEFAULT_IQAMA_MINUTES },
  features: { ...DEFAULT_WORSHIP_FEATURES },
  alarmSound: DEFAULT_ALARM_SOUND,
};

/** Coerce a stored value to a valid IqamaMinutes, defaulting each key defensively. */
function coerceIqama(raw: unknown): IqamaMinutes {
  const src = isRecord(raw) ? raw : {};
  const out = {} as IqamaMinutes;
  for (const key of Object.keys(DEFAULT_IQAMA_MINUTES) as IqamaPrayer[]) {
    const v = src[key];
    out[key] =
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 60
        ? Math.round(v)
        : DEFAULT_IQAMA_MINUTES[key];
  }
  return out;
}

/** Coerce a stored value to valid WorshipFeatures — each key off unless a real `true`. */
function coerceFeatures(raw: unknown): WorshipFeatures {
  const src = isRecord(raw) ? raw : {};
  const out = {} as WorshipFeatures;
  for (const key of Object.keys(DEFAULT_WORSHIP_FEATURES) as WorshipFeatureKey[]) {
    out[key] = src[key] === true;
  }
  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Migrate any older/partial envelope to the current AppState shape. */
function migrate(raw: unknown): AppState {
  if (!isRecord(raw)) return { ...DEFAULT_STATE };

  // Future migrations would branch on raw.v here. For now coerce defensively.
  const reminder = isRecord(raw.reminderPrefs) ? raw.reminderPrefs : {};

  return {
    v: CURRENT_VERSION,
    location: isRecord(raw.location)
      ? (raw.location as unknown as StoredLocation)
      : null,
    method: typeof raw.method === "string" ? raw.method : null,
    methodAuto: typeof raw.methodAuto === "boolean" ? raw.methodAuto : true,
    asr:
      raw.asr === "Standard" || raw.asr === "Hanafi"
        ? (raw.asr as AsrMadhab)
        : null,
    language:
      raw.language === "ar" || raw.language === "en"
        ? (raw.language as Lang)
        : null,
    reminderPrefs: {
      enabled:
        typeof reminder.enabled === "boolean"
          ? reminder.enabled
          : DEFAULT_REMINDER_PREFS.enabled,
      leadMinutes: Array.isArray(reminder.leadMinutes)
        ? reminder.leadMinutes.filter((n): n is number => typeof n === "number")
        : DEFAULT_REMINDER_PREFS.leadMinutes,
      prayers: Array.isArray(reminder.prayers)
        ? reminder.prayers.filter((s): s is string => typeof s === "string")
        : DEFAULT_REMINDER_PREFS.prayers,
    },
    iqamaMinutes: coerceIqama(raw.iqamaMinutes),
    features: coerceFeatures(raw.features),
    alarmSound: isSelectableToneId(raw.alarmSound) ? raw.alarmSound : DEFAULT_ALARM_SOUND,
  };
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    return migrate(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, v: CURRENT_VERSION }));
  } catch {
    // storage full / disabled (private mode) — fail silently, app still works in-memory
  }
}

/** Immutably patch and persist a subset of state. Returns the new state. */
export function patchState(patch: Partial<AppState>): AppState {
  const next: AppState = { ...loadState(), ...patch, v: CURRENT_VERSION };
  saveState(next);
  return next;
}
