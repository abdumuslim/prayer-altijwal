// Add/edit one reminder rule: timing (at the adhan, or N minutes before) + which
// prayers. Ported from the home project's AlertForm, restyled for this app.

import { useState } from "react";
import { Check, Clock } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { localizeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AlertTiming, PrayerAlert, PrayerName } from "@/types/api";
import type { StringKey } from "@/i18n/strings.en";

const REMINDER_PRAYERS: PrayerName[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const MINUTE_PRESETS = [5, 10, 15, 30];

export interface AlertDraft {
  timing: AlertTiming;
  minutes: number | null;
  prayers: PrayerName[];
}

interface AlertFormProps {
  initial?: PrayerAlert;
  busy?: boolean;
  onSave: (draft: AlertDraft) => void;
  onCancel: () => void;
}

export function AlertForm({ initial, busy, onSave, onCancel }: AlertFormProps) {
  const { t, lang } = useI18n();
  const [timing, setTiming] = useState<AlertTiming>(initial?.timing ?? "before");
  const [minutes, setMinutes] = useState<number>(initial?.minutes ?? 10);
  const [prayers, setPrayers] = useState<Set<PrayerName>>(
    new Set(initial?.prayers ?? REMINDER_PRAYERS),
  );

  const togglePrayer = (name: PrayerName) => {
    setPrayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allOn = prayers.size === REMINDER_PRAYERS.length;
  const toggleAll = () =>
    setPrayers(allOn ? new Set<PrayerName>() : new Set(REMINDER_PRAYERS));

  const canSave = prayers.size > 0 && !busy;
  const save = () =>
    canSave &&
    onSave({
      timing,
      minutes: timing === "before" ? minutes : null,
      prayers: REMINDER_PRAYERS.filter((p) => prayers.has(p)),
    });

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-teal/30 bg-white/[0.03] p-3.5">
      {/* Timing */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {t("notify.timing")}
        </span>
        <div className="grid grid-cols-2 gap-2">
          {(["at_time", "before"] as const).map((v) => {
            const active = timing === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setTiming(v)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                  active
                    ? "border-teal/50 bg-teal/10 text-teal"
                    : "border-border-soft/60 bg-white/[0.02] text-ink-dim hover:text-ink",
                )}
              >
                <Clock className="size-3.5" />
                {v === "at_time" ? t("notify.atTime") : t("notify.beforeTiming")}
              </button>
            );
          })}
        </div>
      </div>

      {/* Minutes before */}
      {timing === "before" && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("notify.leadTime")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {MINUTE_PRESETS.map((m) => {
              const active = minutes === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMinutes(m)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-gold/50 bg-gold/10 text-gold"
                      : "border-border-soft/60 bg-white/[0.02] text-ink-dim hover:text-ink",
                  )}
                >
                  {t("notify.minBefore", { min: localizeNumber(m, lang) })}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Prayers */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("notify.prayers")}
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="text-[11px] font-semibold text-teal hover:underline"
          >
            {allOn ? t("notify.clearAll") : t("notify.selectAll")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REMINDER_PRAYERS.map((name) => {
            const Icon = PRAYER_ICONS[name];
            const on = prayers.has(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => togglePrayer(name)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  on
                    ? "border-emerald/50 bg-emerald/10 text-emerald"
                    : "border-border-soft/60 bg-white/[0.02] text-ink-dim hover:text-ink",
                )}
              >
                <Icon className="size-3.5" />
                {t(`prayer.${name}` as StringKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-deep to-emerald px-4 py-2 text-sm font-semibold text-night-2 transition disabled:opacity-50 hover:brightness-110"
        >
          <Check className="size-4" />
          {t("notify.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border-soft bg-white/[0.03] px-4 py-2 text-sm font-medium text-ink-dim transition-colors hover:bg-white/[0.06]"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
