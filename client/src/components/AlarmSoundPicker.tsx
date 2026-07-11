// Alarm-tone picker (Settings → reminders). Lists the bundled tones; tapping a
// row selects it AND previews it (a direct gesture, so playback is never
// blocked). Tapping the currently-playing row stops the preview. The chosen tone
// is the global alarm sound (persisted via useSettings.setAlarmSound) that every
// alarm-kind reminder plays. Previews stop when the panel closes (unmount).

import { useEffect, useState } from "react";
import { AlarmClock, Check, Pause, Play } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ALARM_SOUNDS, alarmSoundSrc } from "@/lib/alarm-sounds";
import { previewAlarm, stopPreview } from "@/lib/alarm-sound";
import { cn } from "@/lib/utils";

interface AlarmSoundPickerProps {
  selected: string;
  onSelect: (id: string) => void;
}

export function AlarmSoundPicker({ selected, onSelect }: AlarmSoundPickerProps) {
  const { t, lang } = useI18n();
  const [previewing, setPreviewing] = useState<string | null>(null);

  // Stop any preview when the picker unmounts (Settings closed).
  useEffect(() => () => stopPreview(), []);

  const onRow = (id: string) => {
    onSelect(id);
    if (previewing === id) {
      stopPreview();
      setPreviewing(null);
      return;
    }
    setPreviewing(id);
    void previewAlarm(alarmSoundSrc(id), () => setPreviewing(null));
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border-soft/60 pt-3.5">
      <div className="flex items-center gap-2">
        <AlarmClock className="size-4 text-gold" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {t("notify.alarmSound")}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {ALARM_SOUNDS.map((sound) => {
          const isSelected = selected === sound.id;
          const isPlaying = previewing === sound.id;
          return (
            <button
              key={sound.id}
              type="button"
              onClick={() => onRow(sound.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-start transition-colors",
                isSelected
                  ? "border-gold/50 bg-gold/10"
                  : "border-border-soft/60 bg-white/[0.02] hover:bg-white/[0.04]",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full",
                  isPlaying ? "bg-gold/20 text-gold" : "text-ink-dim",
                )}
              >
                {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  isSelected ? "font-semibold text-gold" : "text-ink",
                )}
              >
                {lang === "en" ? sound.labelEn : sound.labelAr}
              </span>
              {isSelected && <Check className="size-4 shrink-0 text-gold" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
