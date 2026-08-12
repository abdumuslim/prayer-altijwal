import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { num, relative } from "../lib/format";
import { Card, ErrorNote, Spinner, StatTile, cx } from "../components/ui";
import { CategoryBars, StackedBars } from "../components/charts";
import { TileMap } from "../components/TileMap";

const RANGES = [7, 30, 90];

/**
 * Google Places spend and where it goes.
 *
 * Everything here reads tables the app has been writing since ADR-014 — no new
 * collection was needed to answer "what is this costing me and who is spending
 * it". `day` is a PACIFIC calendar day throughout, because that is the zone
 * Google's free tier resets in.
 */
export function Cost() {
  const [days, setDays] = useState(30);

  const statsFetcher = useCallback(() => api.placesStats(days), [days]);
  const clientsFetcher = useCallback(() => api.topClients(days), [days]);
  const demandFetcher = useCallback(() => api.demand(days), [days]);

  const stats = useApi(statsFetcher);
  const clients = useApi(clientsFetcher);
  const demand = useApi(demandFetcher);

  const plan = stats.data?.plan ?? null;
  const usedPct = plan ? Math.round((plan.usedThisMonth / Math.max(1, plan.monthlyCap)) * 100) : 0;

  // Cache hit rate = everything answered without a paid upstream call.
  const totals = (stats.data?.daily ?? []).reduce(
    (acc, d) => {
      for (const [outcome, n] of Object.entries(d.outcomes)) {
        acc.byOutcome[outcome] = (acc.byOutcome[outcome] ?? 0) + n;
        acc.total += n;
      }
      acc.units += d.units;
      return acc;
    },
    { byOutcome: {} as Record<string, number>, total: 0, units: 0 },
  );
  const paid = (totals.byOutcome.live ?? 0) + (totals.byOutcome.travel_live ?? 0);
  const freeRate = totals.total > 0 ? Math.round(((totals.total - paid) / totals.total) * 100) : 0;
  const denied =
    (totals.byOutcome.denied_budget ?? 0) +
    (totals.byOutcome.denied_client ?? 0) +
    (totals.byOutcome.denied_ip ?? 0);

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

      {stats.error && <ErrorNote message={stats.error} onRetry={stats.reload} />}
      {stats.loading && !stats.data && <Spinner label="Loading spend" />}

      {stats.data && (
        <Card
          title="Monthly budget"
          subtitle={`Billing month ${stats.data.billingMonth} · resets at midnight Pacific, which is when Google's free tier does`}
        >
          {plan ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Units used"
                value={`${num(plan.usedThisMonth)} / ${num(plan.monthlyCap)}`}
                tone={usedPct >= 80 ? "danger" : usedPct >= 50 ? "warn" : "ok"}
                hint={`${usedPct}% of the self-imposed cap`}
              />
              <StatTile
                label="Today's pool"
                value={num(plan.dailyPool)}
                hint={`${num(plan.reserve)} held in reserve`}
              />
              <StatTile
                label="Per-client cap"
                value={num(plan.perClientCap)}
                hint={`per IP: ${num(plan.perIpCap)}`}
              />
              <StatTile label="Active clients" value={num(plan.activeClients)} />
            </div>
          ) : (
            <p className="text-sm text-muted">
              The spend governor is not running (no database, or Places is disabled).
            </p>
          )}
        </Card>
      )}

      {stats.data && (
        <Card
          title="Request outcomes"
          subtitle="How each masjid/travel lookup was answered. Only 'live' and 'travel_live' cost money."
        >
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Requests" value={num(totals.total)} hint={`last ${days} days`} />
            <StatTile
              label="Answered free"
              value={`${freeRate}%`}
              tone={freeRate >= 80 ? "ok" : freeRate >= 50 ? "warn" : "danger"}
              hint="resident data or cache"
            />
            <StatTile label="Units spent" value={num(totals.units)} />
            <StatTile
              label="Refused"
              value={num(denied)}
              tone={denied > 0 ? "warn" : "default"}
              hint="budget / client / IP caps"
            />
          </div>
          <StackedBars
            data={stats.data.daily.map((d) => ({ key: d.key, values: d.outcomes }))}
            series={stats.data.outcomes}
            unitLabel="requests per day, by outcome"
          />
        </Card>
      )}

      {stats.data && stats.data.hourlyToday.length > 0 && (
        <Card title="Today, hour by hour">
          <StackedBars
            data={stats.data.hourlyToday.map((d) => ({ key: `${d.key}:00`, values: d.outcomes }))}
            series={stats.data.outcomes}
            unitLabel="requests per hour, by outcome"
            height={160}
          />
        </Card>
      )}

      <Card
        title="What each client costs"
        subtitle="Anonymous per-install ids, truncated. This is the spend the governor paces against."
      >
        {clients.loading && !clients.data && <Spinner />}
        {clients.data && clients.data.items.length === 0 && (
          <p className="py-4 text-sm text-muted">No client has spent anything in this window.</p>
        )}
        {clients.data && clients.data.items.length > 0 && (
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="pb-2 pe-3 font-medium">Client</th>
                  <th className="pb-2 pe-3 text-right font-medium">Requests</th>
                  <th className="pb-2 pe-3 text-right font-medium">Units</th>
                  <th className="pb-2 text-right font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {clients.data.items.map((c) => (
                  <tr key={c.scopeShort} className="border-b border-line/50">
                    <td className="py-1.5 pe-3 font-mono text-xs text-ink">{c.scopeShort}</td>
                    <td className="tnum py-1.5 pe-3 text-right">{num(c.requests)}</td>
                    <td
                      className={cx(
                        "tnum py-1.5 pe-3 text-right",
                        c.spend > 0 ? "text-warn" : "text-muted",
                      )}
                    >
                      {num(c.spend)}
                    </td>
                    <td className="py-1.5 text-right text-xs text-muted">{relative(c.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Where lookups happen"
        subtitle="~1 km cells. Carries no client id by design — it answers 'where would more masjid data pay off', not 'who went where'."
      >
        {demand.loading && !demand.data && <Spinner />}
        {demand.data && (
          <>
            <TileMap
              points={demand.data.items.map((c) => ({
                lat: c.lat,
                lon: c.lon,
                n: c.n,
                label: c.cellKey,
              }))}
              unitLabel={`masjid lookups over ${days} days`}
            />
            <div className="mt-4">
              <CategoryBars
                data={demand.data.items
                  .slice()
                  .sort((a, b) => b.misses - a.misses)
                  .slice(0, 8)
                  .map((c) => ({ key: `${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`, n: c.misses }))}
                unitLabel="cells that most often cost a live Google call — the best candidates for more offline data"
                emptyLabel="No cell has needed a paid lookup."
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
