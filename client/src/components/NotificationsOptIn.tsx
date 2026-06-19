// Prayer reminders opt-in: enable/disable, per-prayer toggles, lead-time chips
// (0/5/10/15 min). Shows the iOS "Add to Home Screen" hint when iOS && !standalone.

import { Bell, BellOff, BellRing, Share, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { PRAYER_ICONS } from "@/components/ui/icons";
import { localizeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PrayerName } from "@/types/api";
import type { StringKey } from "@/i18n/strings.en";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";

const REMINDER_PRAYERS: PrayerName[] = [
  "fajr",
  "dhuhr",
  "asr",
  "maghrib",
  "isha",
];
const LEAD_OPTIONS = [0, 5, 10, 15];

interface NotificationsOptInProps {
  push: UsePushSubscription;
}

export function NotificationsOptIn({ push }: NotificationsOptInProps) {
  const { t, lang } = useI18n();
  const { status, prefs } = push;

  const togglePrayer = (name: string) => {
    const set = new Set(prefs.prayers);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    push.setPrayers([...set]);
  };

  const toggleLead = (min: number) => {
    const set = new Set(prefs.leadMinutes);
    if (set.has(min)) set.delete(min);
    else set.add(min);
    const next = [...set].sort((a, b) => a - b);
    push.setLeadMinutes(next.length ? next : [0]);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-gold/10 text-gold">
          <BellRing className="size-4.5" />
        </span>
        <div className="flex flex-col leading-tight">
          <h3 className="text-sm font-bold text-ink">{t("notify.title")}</h3>
          <span className="text-xs text-ink-dim">{t("notify.subtitle")}</span>
        </div>
      </div>

      {status === "ios-install" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-gold/30 bg-gold/[0.07] px-3.5 py-3">
          <Share className="mt-0.5 size-4.5 shrink-0 text-gold" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-gold">
              {t("notify.iosHint")}
            </span>
            <span className="text-xs text-ink-dim">{t("notify.iosHintDetail")}</span>
          </div>
        </div>
      )}

      {status === "unsupported" && (
        <p className="rounded-xl border border-border-soft bg-white/[0.02] px-3.5 py-3 text-sm text-ink-dim">
          {t("notify.unsupported")}
        </p>
      )}

      {status === "denied" && (
        <p className="rounded-xl border border-imminent/30 bg-imminent/[0.07] px-3.5 py-3 text-sm text-imminent">
          {t("notify.permissionDenied")}
        </p>
      )}

      {(status === "default" ||
        status === "subscribed" ||
        status === "working" ||
        status === "error") && (
        <>
          <button
            type="button"
            disabled={status === "working"}
            onClick={() =>
              status === "subscribed" ? void push.disable() : void push.enable()
            }
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60",
              status === "subscribed"
                ? "border border-border-soft bg-white/[0.03] text-ink-dim hover:bg-white/[0.06]"
                : "bg-gradient-to-r from-emerald-deep to-emerald text-night-2 hover:brightness-110",
            )}
          >
            {status === "working" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("notify.saving")}
              </>
            ) : status === "subscribed" ? (
              <>
                <BellOff className="size-4" />
                {t("notify.disable")}
              </>
            ) : (
              <>
                <Bell className="size-4" />
                {t("notify.enable")}
              </>
            )}
          </button>

          {push.error && status === "error" && (
            <p className="text-xs text-imminent">{push.error}</p>
          )}

          {status === "subscribed" && (
            <div className="flex flex-col gap-4 rounded-xl border border-border-soft/70 bg-white/[0.02] p-3.5">
              {/* Per-prayer */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {t("notify.prayers")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {REMINDER_PRAYERS.map((name) => {
                    const Icon = PRAYER_ICONS[name];
                    const on = prefs.prayers.includes(name);
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

              {/* Lead-time chips */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {t("notify.leadTime")}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_OPTIONS.map((min) => {
                    const on = prefs.leadMinutes.includes(min);
                    return (
                      <button
                        key={min}
                        type="button"
                        onClick={() => toggleLead(min)}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          on
                            ? "border-gold/50 bg-gold/10 text-gold"
                            : "border-border-soft/60 bg-white/[0.02] text-ink-dim hover:text-ink",
                        )}
                      >
                        {min === 0
                          ? t("notify.atTime")
                          : t("notify.minBefore", { min: localizeNumber(min, lang) })}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
