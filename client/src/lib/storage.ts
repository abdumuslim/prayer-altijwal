// Versioned localStorage envelope with safe migration. All persisted client
// state lives under a single key as { v: 1, ... } so future schema changes can
// migrate forward without corrupting older data.

import type { AsrMadhab, Lang } from "@/types/api";

const STORAGE_KEY = "prayer.app.v1";
const CURRENT_VERSION = 1 as const;

export interface StoredLocation {
  city: string | null;
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

export interface AppState {
  v: typeof CURRENT_VERSION;
  location: StoredLocation | null;
  method: string | null;
  /** When true, the method follows country auto-detection. */
  methodAuto: boolean;
  asr: AsrMadhab | null;
  language: Lang | null;
  reminderPrefs: ReminderPrefs;
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
};

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
