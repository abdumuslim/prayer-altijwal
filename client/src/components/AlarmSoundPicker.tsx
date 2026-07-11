// Alarm-tone dropdown (Settings → reminders). Closed: one compact row showing
// the selected tone + a preview play/stop control. Open: an inline-expanding
// list of the bundled tones plus — native only — the device's own system alarm
// tones (fetched from the PrayerAlarm plugin). Selecting a row previews it (a
// direct gesture, playback never blocked) and closes the list. Bundled tones
// preview via the shared web audio element; device tones preview natively
// (the webview cannot play content:// URIs). Previews stop on unmount.

import { useEffect, useRef, useState } from "react";
import { AlarmClock, Check, ChevronDown, Pause, Play } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import {
  ALARM_SOUNDS,
  alarmSoundLabel,
  alarmSoundSrc,
  DEFAULT_ALARM_SOUND,
  isDeviceToneId,
} from "@/lib/alarm-sounds";
import { previewAlarm, stopPreview } from "@/lib/alarm-sound";
import { isNative, PrayerAlarm, type DeviceTone } from "@/lib/native";
import { cn } from "@/lib/utils";

interface AlarmSoundPickerProps {
  selected: string;
  onSelect: (id: string) => void;
}

export function AlarmSoundPicker({ selected, onSelect }: AlarmSoundPickerProps) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [deviceTones, setDeviceTones] = useState<DeviceTone[]>([]);
  const loadedRef = useRef(false);

  // Native: fetch the device's system alarm tones once. If the persisted
  // selection is a device tone that no longer exists, fall back to the default
  // bundled tone (the service would fall back at ring time anyway — keep the
  // UI truthful too).
  useEffect(() => {
    if (!isNative() || loadedRef.current) return;
    loadedRef.current = true;
    void PrayerAlarm.listDeviceTones()
      .then(({ tones }) => {
        setDeviceTones(tones);
        if (isDeviceToneId(selected) && !tones.some((x) => x.id === selected)) {
          onSelect(DEFAULT_ALARM_SOUND);
        }
      })
      .catch(() => {
        // listing is best-effort — the group simply stays hidden
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop any preview (web + native) when the picker unmounts (Settings closed).
  useEffect(
    () => () => {
      stopPreview();
      if (isNative()) void PrayerAlarm.stopTonePreview().catch(() => {});
    },
    [],
  );

  const stopAllPreviews = () => {
    stopPreview();
    if (isNative()) void PrayerAlarm.stopTonePreview().catch(() => {});
    setPreviewing(null);
  };

  const startPreview = (id: string) => {
    stopAllPreviews();
    setPreviewing(id);
    if (isDeviceToneId(id)) {
      void PrayerAlarm.previewTone({ id }).catch(() => setPreviewing(null));
    } else {
      void previewAlarm(alarmSoundSrc(id), () => setPreviewing(null));
    }
  };

  const label = (id: string): string => {
    if (isDeviceToneId(id)) {
      return deviceTones.find((x) => x.id === id)?.title ?? "";
    }
    return alarmSoundLabel(id, lang);
  };

  const onRow = (id: string) => {
    onSelect(id);
    startPreview(id);
    setOpen(false);
  };

  const onPreviewToggle = () => {
    if (previewing === selected) stopAllPreviews();
    else startPreview(selected);
  };

  const isPlaying = previewing === selected;

  return (
    <div className="flex flex-col gap-2 border-t border-border-soft/60 pt-3.5">
      <div className="flex items-center gap-2">
        <AlarmClock className="size-4 text-gold" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {t("notify.alarmSound")}
        </span>
      </div>

      {/* Closed row: preview control + selected tone + chevron */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPreviewToggle}
          aria-label={t("notify.alarmSound")}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors",
            isPlaying
              ? "border-gold/50 bg-gold/15 text-gold"
              : "border-border-soft/60 bg-white/[0.02] text-ink-dim hover:bg-white/[0.05]",
          )}
        >
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border-soft/60 bg-white/[0.02] px-3 py-2 text-start transition-colors hover:bg-white/[0.04]"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gold">
            {label(selected)}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-ink-dim transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {/* Expanded list: bundled tones + (native) device tones */}
      {open && (
        <div className="scrollbar-hide flex max-h-64 flex-col gap-1 overflow-y-auto rounded-xl border border-border-soft/60 bg-night-2/80 p-1.5">
          <GroupHeader show={deviceTones.length > 0}>{t("notify.tonesApp")}</GroupHeader>
          {ALARM_SOUNDS.map((sound) => (
            <ToneRow
              key={sound.id}
              label={lang === "en" ? sound.labelEn : sound.labelAr}
              isSelected={selected === sound.id}
              onClick={() => onRow(sound.id)}
            />
          ))}
          {deviceTones.length > 0 && (
            <>
              <GroupHeader show>{t("notify.tonesDevice")}</GroupHeader>
              {deviceTones.map((tone) => (
                <ToneRow
                  key={tone.id}
                  label={tone.title}
                  isSelected={selected === tone.id}
                  onClick={() => onRow(tone.id)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GroupHeader({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <span className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </span>
  );
}

interface ToneRowProps {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}

function ToneRow({ label, isSelected, onClick }: ToneRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isSelected}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-start transition-colors",
        isSelected ? "bg-gold/10" : "hover:bg-white/[0.04]",
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          isSelected ? "font-semibold text-gold" : "text-ink",
        )}
      >
        {label}
      </span>
      {isSelected && <Check className="size-4 shrink-0 text-gold" />}
    </button>
  );
}
