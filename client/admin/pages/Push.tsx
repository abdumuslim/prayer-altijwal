import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { num, relative, timestamp } from "../lib/format";
import { Badge, Button, Card, ErrorNote, Spinner, StatTile, cx } from "../components/ui";
import { CategoryBars, StackedBars } from "../components/charts";

const RANGES = [7, 30, 90];

/**
 * Reminder delivery health.
 *
 * The sends chart is backed by push_stats rather than push_log: the ledger is
 * pruned at 48h (it exists to dedup fires across restarts), so it could never
 * answer "how many reminders went out last month".
 */
export function Push() {
  const [days, setDays] = useState(30);
  const fetcher = useCallback(() => api.pushSummary(days), [days]);
  const { data, error, loading, reload } = useApi(fetcher);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const remove = async (id: number) => {
    setBusyId(id);
    try {
      await api.deleteSubscription(id);
      setConfirmId(null);
      reload();
    } finally {
      setBusyId(null);
    }
  };

  const totals = (data?.sends ?? []).reduce(
    (acc, d) => ({
      sent: acc.sent + d.sent,
      failed: acc.failed + d.failed,
      gone: acc.gone + d.gone,
    }),
    { sent: 0, failed: 0, gone: 0 },
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {RANGES.map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            aria-current={days === d ? "true" : undefined}
            className={cx(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              days === d
                ? "border-accent/50 bg-surface-2 font-medium text-ink"
                : "border-line text-muted hover:text-ink",
            )}
          >
            {d}d
          </button>
        ))}
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading push health" />}
      {data && !data.enabled && (
        <Card title="Push">
          <p className="text-sm text-muted">No database — subscriber data is unavailable.</p>
        </Card>
      )}

      {data?.enabled && (
        <>
          <Card title="Delivery" subtitle={`Totals over the last ${days} days`}>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Subscribers" value={num(data.subscriptions.total)} />
              <StatTile label="Alert rules" value={num(data.rules.total)} />
              <StatTile label="Sent" value={num(totals.sent)} tone="ok" />
              <StatTile
                label="Failed / dead"
                value={`${num(totals.failed)} / ${num(totals.gone)}`}
                tone={totals.failed > 0 ? "danger" : "default"}
                hint="dead endpoints are removed automatically"
              />
            </div>
            <StackedBars
              data={data.sends.map((d) => ({
                key: d.day,
                values: { sent: d.sent, failed: d.failed, gone: d.gone },
              }))}
              series={["sent", "failed", "gone"]}
              unitLabel="push deliveries per day"
              emptyLabel="No deliveries recorded yet — this rollup starts filling from the deploy that added it."
            />
          </Card>

          <div className="grid gap-5 sm:grid-cols-2">
            <Card title="Rules by prayer" subtitle="A rule can target several prayers at once">
              <CategoryBars data={data.rules.byPrayer} unitLabel="alert rules" />
            </Card>
            <Card title="Rules by kind and timing">
              <CategoryBars data={data.rules.byKind} unitLabel="notification vs full-screen alarm" />
              <div className="mt-4">
                <CategoryBars data={data.rules.byTiming} unitLabel="at time / before / after" />
              </div>
            </Card>
            <Card title="Subscribers by country">
              <CategoryBars data={data.subscriptions.byCountry} unitLabel="subscribers" />
            </Card>
            <Card title="Subscribers by timezone">
              <CategoryBars data={data.subscriptions.byTz} unitLabel="subscribers" />
            </Card>
          </div>

          <Card
            title="Subscribers"
            subtitle="Push endpoints are shown as their host only — the full URL is a credential that can send to the device. Coordinates are rounded to ~1 km."
          >
            {data.subscribers.length === 0 ? (
              <p className="py-4 text-sm text-muted">No subscribers yet.</p>
            ) : (
              <div className="scroll-x">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="pb-2 pe-3 font-medium">#</th>
                      <th className="pb-2 pe-3 font-medium">Service</th>
                      <th className="pb-2 pe-3 font-medium">Where</th>
                      <th className="pb-2 pe-3 text-right font-medium">Rules</th>
                      <th className="pb-2 pe-3 font-medium">Added</th>
                      <th className="pb-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.subscribers.map((s) => (
                      <tr key={s.id} className="border-b border-line/50">
                        <td className="tnum py-1.5 pe-3 text-muted">{s.id}</td>
                        <td className="py-1.5 pe-3 font-mono text-xs">{s.endpointHost}</td>
                        <td className="py-1.5 pe-3 text-xs">
                          {s.country ?? "—"}{" "}
                          <span className="text-muted">
                            {s.tz ?? ""}
                            {s.lat !== null && s.lon !== null ? ` · ${s.lat}, ${s.lon}` : ""}
                          </span>
                        </td>
                        <td className="tnum py-1.5 pe-3 text-right">{num(s.rules)}</td>
                        <td className="py-1.5 pe-3 text-xs text-muted" title={timestamp(s.createdAt)}>
                          {relative(s.createdAt)}
                        </td>
                        <td className="py-1.5 text-right">
                          {confirmId === s.id ? (
                            <span className="flex items-center justify-end gap-2">
                              <Badge tone="danger">delete?</Badge>
                              <Button
                                variant="danger"
                                disabled={busyId === s.id}
                                onClick={() => void remove(s.id)}
                              >
                                Yes
                              </Button>
                              <Button variant="ghost" onClick={() => setConfirmId(null)}>
                                No
                              </Button>
                            </span>
                          ) : (
                            <Button variant="ghost" onClick={() => setConfirmId(s.id)}>
                              Delete
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
