// Catalog of selectable alarm tones. The audio files live in client/public/alarms
// (served at /alarms/<file>) and are only fetched when an alarm plays or is
// previewed — never part of the JS bundle. The chosen tone id is persisted in
// prayer.app.v1 (`alarmSound`); the player resolves it via getSelectedAlarmSrc().

export interface AlarmSound {
  id: string;
  /** Filename under /alarms/. */
  file: string;
  labelAr: string;
  labelEn: string;
}

// Labels are generic numbered tones (نغمة N / Tone N) — the counter follows this
// array order. The `id`/`file` stay descriptive for the on-disk assets.
export const ALARM_SOUNDS: AlarmSound[] = [
  { id: "soft-plucks", file: "soft-plucks.mp3", labelAr: "نغمة 1", labelEn: "Tone 1" },
  { id: "star-dust", file: "star-dust.mp3", labelAr: "نغمة 2", labelEn: "Tone 2" },
  { id: "morning-joy", file: "morning-joy.mp3", labelAr: "نغمة 3", labelEn: "Tone 3" },
  { id: "mindful-1", file: "mindful-1.mp3", labelAr: "نغمة 4", labelEn: "Tone 4" },
  { id: "mindful-2", file: "mindful-2.mp3", labelAr: "نغمة 5", labelEn: "Tone 5" },
  { id: "mindful-3", file: "mindful-3.mp3", labelAr: "نغمة 6", labelEn: "Tone 6" },
  { id: "classic", file: "classic.mp3", labelAr: "نغمة 7", labelEn: "Tone 7" },
  { id: "clock", file: "clock.mp3", labelAr: "نغمة 8", labelEn: "Tone 8" },
];

export const DEFAULT_ALARM_SOUND = "soft-plucks";

/** True when `id` names a known alarm tone. */
export function isAlarmSoundId(id: unknown): id is string {
  return typeof id === "string" && ALARM_SOUNDS.some((s) => s.id === id);
}

/** Public URL of a tone by id, falling back to the default when unknown. */
export function alarmSoundSrc(id: string): string {
  const sound =
    ALARM_SOUNDS.find((s) => s.id === id) ??
    ALARM_SOUNDS.find((s) => s.id === DEFAULT_ALARM_SOUND) ??
    ALARM_SOUNDS[0];
  return `/alarms/${sound.file}`;
}

/** Localized label for a tone by id. */
export function alarmSoundLabel(id: string, lang: string): string {
  const sound = ALARM_SOUNDS.find((s) => s.id === id);
  if (!sound) return "";
  return lang === "en" ? sound.labelEn : sound.labelAr;
}
