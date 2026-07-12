// Web prayer reminders: enable/disable web push, then manage MULTIPLE
// independent reminder rules (shared AlertRuleList). Shows the iOS "Add to Home
// Screen" hint when iOS && !standalone. The native app uses NativeReminders
// instead (SettingsPanel branches on isNative).

import { useEffect, useRef } from "react";
import { Bell, BellOff, Share, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { usePrayerAlerts } from "@/hooks/usePrayerAlerts";
import { AlertRuleList } from "@/components/AlertRuleList";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";

interface NotificationsOptInProps {
  push: UsePushSubscription;
}

export function NotificationsOptIn({ push }: NotificationsOptInProps) {
  const { t } = useI18n();
  const { status, endpoint } = push;
  const { alerts, loading, create, update, remove } = usePrayerAlerts(endpoint);

  // Seed one sensible default rule the first time a device subscribes with none.
  const seeded = useRef(false);
  useEffect(() => {
    if (status !== "subscribed" || !endpoint || loading) return;
    if (alerts.length === 0 && !seeded.current) {
      seeded.current = true;
      void create({
        timing: "before",
        minutes: 10,
        prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
        kind: "notification",
      });
    }
  }, [status, endpoint, loading, alerts.length, create]);

  return (
    <div className="flex flex-col gap-3">
      {status === "ios-install" && (
        <div className="flex items-start gap-2.5 rounded-xl border border-gold/30 bg-gold/[0.07] px-3.5 py-3">
          <Share className="mt-0.5 size-4.5 shrink-0 text-gold" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-gold">{t("notify.iosHint")}</span>
            <span className="text-xs text-ink-dim">{t("notify.iosHintDetail")}</span>
          </div>
        </div>
      )}

      {status === "unsupported" && (
        <p className="rounded-xl border border-border-soft bg-veil/[0.02] px-3.5 py-3 text-sm text-ink-dim">
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
                ? "border border-border-soft bg-veil/[0.03] text-ink-dim hover:bg-veil/[0.06]"
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
            <AlertRuleList
              rules={alerts}
              loading={loading}
              onCreate={create}
              onUpdate={update}
              onRemove={remove}
            />
          )}
        </>
      )}
    </div>
  );
}
