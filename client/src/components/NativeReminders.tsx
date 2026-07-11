// Native (Capacitor) reminders panel: device-local rules (localStorage) + the
// Android permission-onboarding rows that keep true alarms working. Replaces
// NotificationsOptIn on native (SettingsPanel branches on isNative). Rules feed
// the on-device scheduler (useNativeAlarmScheduler, mounted in App).

import { useEffect, useRef } from "react";
import { AlarmClock, BatteryWarning, BellRing, Maximize } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { useLocalAlerts } from "@/hooks/useLocalAlerts";
import { useAlarmPermissions } from "@/hooks/useAlarmPermissions";
import { AlertRuleList } from "@/components/AlertRuleList";
import type { StringKey } from "@/i18n/strings.en";

interface PermRow {
  key: string;
  icon: LucideIcon;
  label: StringKey;
  desc: StringKey;
  btn: StringKey;
  onFix: () => void;
}

export function NativeReminders() {
  const { t } = useI18n();
  const local = useLocalAlerts();
  const perms = useAlarmPermissions();

  // Seed one sensible default rule the first time (mirrors the web default).
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (local.rules.length === 0) {
      local.add({
        timing: "before",
        minutes: 10,
        prayers: ["fajr", "dhuhr", "asr", "maghrib", "isha"],
        kind: "notification",
      });
    }
  }, [local]);

  const st = perms.state;
  const rows: PermRow[] = [];
  if (st) {
    if (st.notifications !== "granted") {
      rows.push({
        key: "notif",
        icon: BellRing,
        label: "notify.permNotifications",
        desc: "notify.permNotificationsDesc",
        btn: "notify.permAllow",
        onFix: perms.requestNotifications,
      });
    }
    if (!st.exactAlarm) {
      rows.push({
        key: "exact",
        icon: AlarmClock,
        label: "notify.permExact",
        desc: "notify.permExactDesc",
        btn: "notify.permOpenSettings",
        onFix: perms.openExact,
      });
    }
    if (!st.fullScreen) {
      rows.push({
        key: "fs",
        icon: Maximize,
        label: "notify.permFullScreen",
        desc: "notify.permFullScreenDesc",
        btn: "notify.permOpenSettings",
        onFix: perms.openFullScreen,
      });
    }
    if (!st.batteryExempt) {
      rows.push({
        key: "batt",
        icon: BatteryWarning,
        label: "notify.permBattery",
        desc: "notify.permBatteryDesc",
        btn: "notify.permOpenSettings",
        onFix: perms.openBattery,
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-dim">{t("notify.offlineNote")}</p>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("notify.permsTitle")}
          </span>
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.05] px-3.5 py-2.5"
            >
              <r.icon className="size-4 shrink-0 text-gold" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold text-ink">{t(r.label)}</span>
                <span className="text-xs text-ink-dim">{t(r.desc)}</span>
              </div>
              <button
                type="button"
                onClick={r.onFix}
                className="shrink-0 rounded-lg border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition-colors hover:bg-gold/20"
              >
                {t(r.btn)}
              </button>
            </div>
          ))}
          {!st?.batteryExempt && (
            <p className="text-[11px] leading-relaxed text-ink-faint">{t("notify.permOemNotice")}</p>
          )}
        </div>
      )}

      <AlertRuleList
        rules={local.rules}
        onCreate={local.add}
        onUpdate={local.update}
        onRemove={local.remove}
      />
    </div>
  );
}
