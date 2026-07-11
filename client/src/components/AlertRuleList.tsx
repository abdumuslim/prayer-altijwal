// The add/edit/delete list of reminder rules, shared by the web (server-backed,
// NotificationsOptIn) and native (localStorage-backed, NativeReminders) reminder
// panels. Data source is injected via the onCreate/onUpdate/onRemove callbacks so
// the same UI drives both PrayerAlert (server) and LocalAlertRule (device) rules.

import { useState } from "react";
import { AlarmClock, BellRing, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeNumber } from "@/lib/format";
import { AlertForm, type AlertDraft } from "@/components/AlertForm";
import { ALERT_TARGET_LABEL, EXTRA_TARGETS, coversAllFard } from "@/lib/alert-targets";
import type { TFunction } from "@/i18n/I18nProvider";
import type { AlertKind, AlertTarget, AlertTiming, Lang } from "@/types/api";

/** The rule fields the list renders (both PrayerAlert and LocalAlertRule satisfy this). */
export interface RuleItem {
  id: number;
  timing: AlertTiming;
  minutes: number | null;
  prayers: AlertTarget[];
  kind: AlertKind;
}

/** Human description of a rule, e.g. "Fajr, Dhuhr — 10 min before". */
function describeRule(a: RuleItem, t: TFunction, lang: Lang): string {
  const extras = a.prayers.filter((p) => EXTRA_TARGETS.includes(p));
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

interface AlertRuleListProps {
  rules: RuleItem[];
  loading?: boolean;
  onCreate: (draft: AlertDraft) => void | Promise<void>;
  onUpdate: (id: number, draft: AlertDraft) => void | Promise<void>;
  onRemove: (id: number) => void | Promise<void>;
}

export function AlertRuleList({ rules, loading, onCreate, onUpdate, onRemove }: AlertRuleListProps) {
  const { t, lang } = useI18n();
  // editing: null = none, "new" = adding, number = editing that rule id
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (id: number | "new", draft: AlertDraft) => {
    setBusy(true);
    try {
      if (id === "new") await onCreate(draft);
      else await onUpdate(id, draft);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {rules.map((a) =>
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
              onClick={() => void onRemove(a.id)}
              className="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-imminent"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ),
      )}

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

      {loading && rules.length === 0 && (
        <p className="py-2 text-center text-xs text-ink-faint">{t("notify.saving")}</p>
      )}
    </div>
  );
}
