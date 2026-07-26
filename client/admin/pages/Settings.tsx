import { useCallback, useState } from "react";
import { api, type SettingsValues } from "../lib/api";
import { useApi } from "../lib/useApi";
import { num, timestamp } from "../lib/format";
import { Badge, Button, Card, ErrorNote, Spinner, cx, inputClass } from "../components/ui";

/**
 * Runtime controls — the safety valve.
 *
 * Every value falls back to its env default when the database is unreachable,
 * so an outage can never silently switch a feature off. Each row shows where
 * its current value actually comes from, and offers a reset to the env value.
 */
export function Settings() {
  const settings = useApi(useCallback(() => api.settings(), []));
  const audit = useApi(useCallback(() => api.audit(50), []));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string | null>(null);

  const apply = async (patch: Partial<SettingsValues>) => {
    setBusy(true);
    setFailed(null);
    try {
      await api.updateSettings(patch);
      settings.reload();
      audit.reload();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = async (name: keyof SettingsValues) => {
    setBusy(true);
    try {
      await api.resetSetting(name);
      setCapDraft(null);
      settings.reload();
      audit.reload();
    } finally {
      setBusy(false);
    }
  };

  if (settings.loading && !settings.data) return <Spinner label="Loading settings" />;
  if (settings.error && !settings.data)
    return <ErrorNote message={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return null;

  const { values, sources, defaults, writable } = settings.data;

  return (
    <div className="space-y-5">
      {failed && <ErrorNote message={failed} />}
      {!writable && (
        <ErrorNote message="No database — settings are read-only and the env values apply." />
      )}

      <Card
        title="Google Places"
        subtitle="Turn the paid upstream off, or lower its ceiling, without a redeploy."
      >
        <div className="space-y-4">
          <Toggle
            label="Nearest-masjid search"
            hint="Off ⇒ /api/places/masjids reports disabled and the app falls back to the offline dataset."
            checked={values.placesEnabled}
            source={sources.placesEnabled}
            fallback={defaults.placesEnabled ? "on" : "off"}
            disabled={busy || !writable}
            onChange={(v) => void apply({ placesEnabled: v })}
            onReset={() => void reset("placesEnabled")}
          />
          <Toggle
            label="Travel times on expand"
            hint="The expensive half — 2 units per lookup. Can be turned off while the masjid list stays on."
            checked={values.placesTravelEnabled}
            source={sources.placesTravelEnabled}
            fallback={defaults.placesTravelEnabled ? "on" : "off"}
            disabled={busy || !writable}
            onChange={(v) => void apply({ placesTravelEnabled: v })}
            onReset={() => void reset("placesTravelEnabled")}
          />

          <div className="border-t border-line pt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink">Monthly unit cap</span>
                  <SourceBadge source={sources.placesMonthlyUnitCap} />
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Self-imposed ceiling on paid upstream work. A masjid search costs 1 unit, a travel
                  lookup 2. Env default: {num(defaults.placesMonthlyUnitCap)}.
                </p>
              </div>
              <div className="flex items-end gap-2">
                <input
                  className={cx(inputClass, "tnum w-28")}
                  inputMode="numeric"
                  value={capDraft ?? String(values.placesMonthlyUnitCap)}
                  onChange={(e) => setCapDraft(e.target.value)}
                  disabled={busy || !writable}
                />
                <Button
                  variant="primary"
                  disabled={busy || !writable || capDraft === null}
                  onClick={() => {
                    const n = Number(capDraft);
                    if (!Number.isInteger(n) || n < 0) {
                      setFailed("Cap must be a whole number ≥ 0.");
                      return;
                    }
                    setCapDraft(null);
                    void apply({ placesMonthlyUnitCap: n });
                  }}
                >
                  Save
                </Button>
                {sources.placesMonthlyUnitCap === "db" && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void reset("placesMonthlyUnitCap")}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Telemetry">
        <Toggle
          label="Anonymous audience ping"
          hint="Off ⇒ the endpoint still answers 204 but stores nothing. Requires TELEMETRY_SALT to do anything at all."
          checked={values.telemetryEnabled}
          source={sources.telemetryEnabled}
          fallback={defaults.telemetryEnabled ? "on" : "off"}
          disabled={busy || !writable}
          onChange={(v) => void apply({ telemetryEnabled: v })}
          onReset={() => void reset("telemetryEnabled")}
        />
      </Card>

      <Card
        title="Audit trail"
        subtitle="Every change made here, plus logins and lockouts. IPs are stored as /24 or /64 prefixes."
      >
        {audit.loading && !audit.data && <Spinner />}
        {audit.data && audit.data.items.length === 0 && (
          <p className="py-4 text-sm text-muted">Nothing recorded yet.</p>
        )}
        {audit.data && audit.data.items.length > 0 && (
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="pb-2 pe-3 font-medium">When</th>
                  <th className="pb-2 pe-3 font-medium">Action</th>
                  <th className="pb-2 pe-3 font-medium">Target</th>
                  <th className="pb-2 pe-3 font-medium">From</th>
                  <th className="pb-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.items.map((row) => (
                  <tr key={row.id} className="border-b border-line/50">
                    <td className="tnum py-1.5 pe-3 text-xs text-muted">{timestamp(row.at)}</td>
                    <td className="py-1.5 pe-3 font-mono text-xs text-ink">{row.action}</td>
                    <td className="tnum py-1.5 pe-3 text-xs">{row.target ?? "—"}</td>
                    <td className="py-1.5 pe-3 font-mono text-xs text-muted">
                      {row.actorIp ?? "—"}
                    </td>
                    <td className="py-1.5 font-mono text-[11px] text-muted">
                      {row.details ? JSON.stringify(row.details) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SourceBadge({ source }: { source: "db" | "env" }) {
  return source === "db" ? (
    <Badge tone="warn">overridden</Badge>
  ) : (
    <Badge>env default</Badge>
  );
}

function Toggle({
  label,
  hint,
  checked,
  source,
  fallback,
  disabled,
  onChange,
  onReset,
}: {
  label: string;
  hint: string;
  checked: boolean;
  source: "db" | "env";
  fallback: string;
  disabled: boolean;
  onChange: (value: boolean) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">{label}</span>
          <SourceBadge source={source} />
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {hint} Env default: {fallback}.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cx(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
            checked ? "bg-accent" : "bg-line",
          )}
        >
          <span
            aria-hidden
            className={cx(
              "absolute top-0.5 h-5 w-5 rounded-full bg-bg transition-transform",
              checked ? "translate-x-[22px]" : "translate-x-0.5",
            )}
          />
        </button>
        {source === "db" && (
          <Button variant="ghost" disabled={disabled} onClick={onReset}>
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
