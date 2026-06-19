// Settings slide-over: method picker ("Auto (detected: X)" + manual override +
// reset-to-auto), Asr Standard/Hanafi toggle, language toggle. Also hosts the
// notifications opt-in section.

import { Settings2, Check, RotateCcw, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { SlideOver } from "@/components/ui/SlideOver";
import { LanguageToggle } from "@/components/LanguageToggle";
import { NotificationsOptIn } from "@/components/NotificationsOptIn";
import { METHOD_KEYS, methodLabel } from "@/i18n/methods";
import { cn } from "@/lib/utils";
import type { AsrMadhab, MethodInfo } from "@/types/api";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  /** Resolved method echoed by the server (for "detected: X" + active state). */
  resolvedMethod: MethodInfo | null;
  methodAuto: boolean;
  effectiveAsr: AsrMadhab;
  onSelectMethod: (key: string) => void;
  onResetAuto: () => void;
  onSelectAsr: (asr: AsrMadhab) => void;
  push: UsePushSubscription;
}

export function SettingsPanel({
  open,
  onClose,
  resolvedMethod,
  methodAuto,
  effectiveAsr,
  onSelectMethod,
  onResetAuto,
  onSelectAsr,
  push,
}: SettingsPanelProps) {
  const { t } = useI18n();

  const detectedLabel = resolvedMethod
    ? methodLabel(t, resolvedMethod.key, resolvedMethod.label)
    : "—";
  const activeKey = resolvedMethod?.key ?? null;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={t("settings.title")}
      icon={<Settings2 className="size-5" />}
    >
      <div className="flex flex-col gap-7">
        {/* Calculation method */}
        <section className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink">
              {t("settings.calcMethod")}
            </h3>
            {!methodAuto && (
              <button
                type="button"
                onClick={onResetAuto}
                className="flex items-center gap-1.5 rounded-full bg-emerald/10 px-2.5 py-1 text-[11px] font-semibold text-emerald transition-colors hover:bg-emerald/20"
              >
                <RotateCcw className="size-3" />
                {t("settings.resetAuto")}
              </button>
            )}
          </div>

          {/* Auto row */}
          <button
            type="button"
            onClick={onResetAuto}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-3.5 py-3 text-start transition-colors",
              methodAuto
                ? "border-emerald/50 bg-emerald/10"
                : "border-border-soft bg-white/[0.02] hover:bg-white/[0.05]",
            )}
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg",
                methodAuto ? "bg-emerald/20 text-emerald" : "bg-white/5 text-ink-dim",
              )}
            >
              <Sparkles className="size-4.5" />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-sm font-semibold text-ink">
                {t("settings.autoDetected", { method: detectedLabel })}
              </span>
            </span>
            {methodAuto && <Check className="ms-auto size-5 shrink-0 text-emerald" />}
          </button>

          {/* Baghdad calibration note */}
          {resolvedMethod?.baghdadCalibrated && (
            <p className="flex items-center gap-1.5 ps-1 text-[11px] text-gold">
              <span className="size-1.5 rounded-full bg-gold" />
              {t("settings.baghdadNote")}
            </p>
          )}

          {/* Manual list */}
          <p className="mt-1 ps-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            {t("settings.manual")}
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {METHOD_KEYS.map((key) => {
              const active = !methodAuto && activeKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectMethod(key)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-start transition-colors",
                    active
                      ? "border-gold/50 bg-gold/10"
                      : "border-border-soft/60 bg-white/[0.02] hover:bg-white/[0.05]",
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-medium",
                      active ? "text-gold" : "text-ink/90",
                    )}
                  >
                    {methodLabel(t, key)}
                  </span>
                  {active && <Check className="ms-auto size-4.5 shrink-0 text-gold" />}
                </button>
              );
            })}
          </div>
        </section>

        {/* Asr madhab */}
        <section className="flex flex-col gap-2.5">
          <h3 className="text-sm font-bold text-ink">{t("settings.asr")}</h3>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { v: "Standard", label: t("settings.asr.standard"), hint: t("settings.asr.standardHint") },
                { v: "Hanafi", label: t("settings.asr.hanafi"), hint: t("settings.asr.hanafiHint") },
              ] as const
            ).map((o) => {
              const active = effectiveAsr === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => onSelectAsr(o.v)}
                  className={cn(
                    "flex flex-col gap-0.5 rounded-xl border px-3.5 py-2.5 text-start transition-colors",
                    active
                      ? "border-teal/50 bg-teal/10"
                      : "border-border-soft/60 bg-white/[0.02] hover:bg-white/[0.05]",
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      active ? "text-teal" : "text-ink",
                    )}
                  >
                    {o.label}
                  </span>
                  <span className="text-[11px] text-ink-dim">{o.hint}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Notifications */}
        <NotificationsOptIn push={push} />

        {/* Language */}
        <section className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">{t("settings.language")}</h3>
          <LanguageToggle />
        </section>
      </div>
    </SlideOver>
  );
}
