// Add/edit one reminder rule: timing (at the adhan, or N minutes before / after)
// + which targets (the five fard, plus the sunnah/adhkar anchors). Ported from
// the home project's AlertForm, restyled for this app.

import { useState } from "react";
import { AlarmClock, Bell, Check, Clock, Minus, Plus } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { ALERT_TARGET_ICONS } from "@/components/ui/icons";
import { ALERT_TARGET_LABEL, EXTRA_TARGETS, FARD_TARGETS } from "@/lib/alert-targets";
import { localizeNumber } from "@/lib/format";
import { unlockAlarmAudio } from "@/lib/alarm-sound";
import { cn } from "@/lib/utils";
import type { AlertKind, AlertTarget, AlertTiming } from "@/types/api";

const MINUTE_PRESETS = [5, 10, 15, 30];
const MIN_CUSTOM = 1;
const MAX_CUSTOM = 180;
const CUSTOM_STEP = 5;
const ALL_TARGETS: AlertTarget[] = [...FARD_TARGETS, ...EXTRA_TARGETS];

const clampMinutes = (n: number): number =>
  Math.max(MIN_CUSTOM, Math.min(MAX_CUSTOM, Math.round(n)));

export interface AlertDraft {
  timing: AlertTiming;
  minutes: number | null;
  prayers: AlertTarget[];
  kind: AlertKind;
}

interface AlertFormProps {
  // Any object carrying the draft fields (server PrayerAlert or a local rule).
  initial?: AlertDraft;
  busy?: boolean;
  onSave: (draft: AlertDraft) => void;
  onCancel: () => void;
}

export function AlertForm({ initial, busy, onSave, onCancel }: AlertFormProps) {
  const { t, lang } = useI18n();
  const [kind, setKind] = useState<AlertKind>(initial?.kind ?? "notification");
  const [timing, setTiming] = useState<AlertTiming>(initial?.timing ?? "before");
  const [minutes, setMinutes] = useState<number>(initial?.minutes ?? 10);
  // Custom minutes: on when editing a rule whose minutes aren't one of the presets.
  const [isCustom, setIsCustom] = useState<boolean>(
    () => initial?.minutes != null && !MINUTE_PRESETS.includes(initial.minutes),
  );
  const [prayers, setPrayers] = useState<Set<AlertTarget>>(
    new Set(initial?.prayers ?? FARD_TARGETS),
  );

  // Pre-warm the audio pipeline from this tap so a later push-driven alarm can
  // play without its own user gesture.
  const chooseKind = (k: AlertKind) => {
    setKind(k);
    if (k === "alarm") unlockAlarmAudio();
  };

  const toggleTarget = (name: AlertTarget) => {
    setPrayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // "Select all" governs only the fard five (preserving any selected extras).
  const allFardOn = FARD_TARGETS.every((p) => prayers.has(p));
  const toggleAllFard = () =>
    setPrayers((prev) => {
      const next = new Set(prev);
      if (allFardOn) FARD_TARGETS.forEach((p) => next.delete(p));
      else FARD_TARGETS.forEach((p) => next.add(p));
      return next;
    });

  const canSave = prayers.size > 0 && !busy;
  const save = () => {
    if (!canSave) return;
    if (kind === "alarm") unlockAlarmAudio();
    onSave({
      timing,
      minutes: timing === "at_time" ? null : minutes,
      prayers: ALL_TARGETS.filter((p) => prayers.has(p)),
      kind,
    });
  };

  const renderTarget = (name: AlertTarget) => {
    const Icon = ALERT_TARGET_ICONS[name];
    const on = prayers.has(name);
    return (
      <button
        key={name}
        type="button"
        onClick={() => toggleTarget(name)}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          on
            ? "border-emerald/50 bg-emerald/10 text-emerald"
            : "border-border-soft/60 bg-veil/[0.02] text-ink-dim hover:text-ink",
        )}
      >
        <Icon className="size-3.5" />
        {t(ALERT_TARGET_LABEL[name])}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-teal/30 bg-veil/[0.03] p-3.5">
      {/* Kind — notification vs full-screen alarm */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {t("notify.kind")}
        </span>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "notification", icon: Bell, labelKey: "notify.kindNotification" },
              { value: "alarm", icon: AlarmClock, labelKey: "notify.kindAlarm" },
            ] as const
          ).map(({ value, icon: Icon, labelKey }) => {
            const active = kind === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => chooseKind(value)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors",
                  active
                    ? "border-gold/50 bg-gold/10 text-gold"
                    : "border-border-soft/60 bg-veil/[0.02] text-ink-dim hover:text-ink",
                )}
              >
                <Icon className="size-3.5" />
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Timing */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {t("notify.timing")}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {(["at_time", "before", "after"] as const).map((v) => {
            const active = timing === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setTiming(v)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-semibold transition-colors",
                  active
                    ? "border-teal/50 bg-teal/10 text-teal"
                    : "border-border-soft/60 bg-veil/[0.02] text-ink-dim hover:text-ink",
                )}
              >
                <Clock className="size-3.5" />
                {v === "at_time"
                  ? t("notify.atTime")
                  : v === "before"
                    ? t("notify.beforeTiming")
                    : t("notify.afterTiming")}
              </button>
            );
          })}
        </div>
      </div>

      {/* Minutes before / after */}
      {timing !== "at_time" && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {timing === "before" ? t("notify.leadTime") : t("notify.leadTimeAfter")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {MINUTE_PRESETS.map((m) => {
              const active = !isCustom && minutes === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setIsCustom(false);
                    setMinutes(m);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-gold/50 bg-gold/10 text-gold"
                      : "border-border-soft/60 bg-veil/[0.02] text-ink-dim hover:text-ink",
                  )}
                >
                  {t(timing === "before" ? "notify.minBefore" : "notify.minAfter", {
                    min: localizeNumber(m, lang),
                  })}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setIsCustom(true)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                isCustom
                  ? "border-gold/50 bg-gold/10 text-gold"
                  : "border-border-soft/60 bg-veil/[0.02] text-ink-dim hover:text-ink",
              )}
            >
              {t("notify.customMinutes")}
            </button>
          </div>

          {isCustom && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={t("iqama.decrease")}
                onClick={() => setMinutes((v) => clampMinutes(v - CUSTOM_STEP))}
                disabled={minutes <= MIN_CUSTOM}
                className="grid size-7 place-items-center rounded-lg border border-border-soft bg-veil/[0.03] text-ink-dim transition-colors hover:text-gold disabled:opacity-40"
              >
                <Minus className="size-3.5" />
              </button>
              <input
                type="text"
                inputMode="numeric"
                value={localizeNumber(minutes, lang)}
                onChange={(e) => {
                  const n = parseInt(e.target.value.replace(/\D/g, ""), 10);
                  if (Number.isFinite(n)) setMinutes(clampMinutes(n));
                }}
                className="tnum w-16 rounded-lg border border-border-soft bg-veil/[0.03] py-1.5 text-center text-sm font-semibold text-ink outline-none focus:border-gold/50"
              />
              <button
                type="button"
                aria-label={t("iqama.increase")}
                onClick={() => setMinutes((v) => clampMinutes(v + CUSTOM_STEP))}
                disabled={minutes >= MAX_CUSTOM}
                className="grid size-7 place-items-center rounded-lg border border-border-soft bg-veil/[0.03] text-ink-dim transition-colors hover:text-gold disabled:opacity-40"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Targets — fard first, then the sunnah/adhkar group */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("notify.prayers")}
          </span>
          <button
            type="button"
            onClick={toggleAllFard}
            className="text-[11px] font-semibold text-teal hover:underline"
          >
            {allFardOn ? t("notify.clearAll") : t("notify.selectAll")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">{FARD_TARGETS.map(renderTarget)}</div>
        <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {t("notify.sunnahTargets")}
        </span>
        <div className="flex flex-wrap gap-1.5">{EXTRA_TARGETS.map(renderTarget)}</div>
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
          className="rounded-xl border border-border-soft bg-veil/[0.03] px-4 py-2 text-sm font-medium text-ink-dim transition-colors hover:bg-veil/[0.06]"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
