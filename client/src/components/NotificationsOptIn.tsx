// Prayer reminders: enable/disable web push, then manage MULTIPLE independent
// reminder rules (different prayers, different timings) — add / edit / delete.
// Shows the iOS "Add to Home Screen" hint when iOS && !standalone.

import { useEffect, useRef, useState } from "react";
import { AlarmClock, Bell, BellOff, BellRing, Share, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePrayerAlerts } from "@/hooks/usePrayerAlerts";
import { AlertForm, type AlertDraft } from "@/components/AlertForm";
import { ALERT_TARGET_LABEL, EXTRA_TARGETS, coversAllFard } from "@/lib/alert-targets";
import type { PrayerAlert } from "@/types/api";
import type { UsePushSubscription } from "@/hooks/usePushSubscription";
import type { TFunction } from "@/i18n/I18nProvider";
import type { Lang } from "@/types/api";

interface NotificationsOptInProps {
  push: UsePushSubscription;
}

/** Human description of a rule, e.g. "Fajr, Dhuhr — 10 min before". */
function describeRule(a: PrayerAlert, t: TFunction, lang: Lang): string {
  const extras = a.prayers.filter((p) => EXTRA_TARGETS.includes(p));
  // "All prayers" collapses the five fard; any selected extras are appended.
  const parts = coversAllFard(a.prayers)
    ? [t("notify.allPrayers"), ...extras.map((p) => t(ALERT_TARGET_LABEL[p]))]
    : a.prayers.map((p) => t(ALERT_TARGET_LABEL[p]));
  const names = parts.join(t("notify.listSep"));
  const timing =
    a.timing === "at_time"
      ? t("notify.atTime")
      : a.timing === "before"
        ? t("notify.minBefore", { min: localizeNumber(a.minutes ?? 0, lang) })
        : t("notify.minAfter", { min: localizeNumber(a.minutes ?? 0, lang) });
  return `${names} — ${timing}`;
}

export function NotificationsOptIn({ push }: NotificationsOptInProps) {
  const { t, lang } = useI18n();
  const { status, endpoint } = push;
  const { alerts, loading, create, update, remove } = usePrayerAlerts(endpoint);

  // editing: null = none, "new" = adding, number = editing that rule id
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState(false);

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

  const save = async (id: number | "new", draft: AlertDraft) => {
    setBusy(true);
    try {
      if (id === "new") await create(draft);
      else await update(id, draft);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

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
            <div className="flex flex-col gap-2">
              {/* Existing rules */}
              {alerts.map((a) =>
                editing === a.id ? (
                  <AlertForm
                    key={a.id}
                    initial={a}
                    busy={busy}
                    onSave={(draft) => void save(a.id, draft)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 rounded-xl border border-border-soft/70 bg-white/[0.02] px-3.5 py-2.5"
                  >
                    {a.kind === "alarm" ? (
                      <AlarmClock className="size-4 shrink-0 text-gold" />
                    ) : (
                      <BellRing className="size-4 shrink-0 text-gold" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {describeRule(a, t, lang)}
                    </span>
                    <button
                      type="button"
                      aria-label={t("notify.edit")}
                      onClick={() => setEditing(a.id)}
                      className="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-teal"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={t("notify.delete")}
                      onClick={() => void remove(a.id)}
                      className="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-imminent"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ),
              )}

              {/* Add new */}
              {editing === "new" ? (
                <AlertForm
                  busy={busy}
                  onSave={(draft) => void save("new", draft)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing("new")}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-soft bg-white/[0.02] px-4 py-2.5 text-sm font-medium text-ink-dim transition-colors hover:border-teal/40 hover:text-teal"
                >
                  <Plus className="size-4" />
                  {t("notify.add")}
                </button>
              )}

              {loading && alerts.length === 0 && (
                <p className="py-2 text-center text-xs text-ink-faint">{t("notify.saving")}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
