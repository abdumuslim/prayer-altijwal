import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { num, pct } from "../lib/format";
import { Card, ErrorNote, Spinner, StatTile, cx } from "../components/ui";
import { CategoryBars, LineSeries } from "../components/charts";
import { TileMap } from "../components/TileMap";

const RANGES = [7, 30, 90];

/**
 * Who uses the app.
 *
 * Every number here is DAILY ACTIVE INSTALLS or an average of them. The install
 * hash rotates every day by design (ADR-016), so cross-day uniques — real
 * WAU/MAU — are mathematically uncomputable from this data. The page says so
 * rather than quietly presenting a number that looks like unique users.
 */
export function Audience() {
  const [days, setDays] = useState(30);
  const fetcher = useCallback(() => api.audience(days), [days]);
  const { data, error, loading, reload } = useApi(fetcher);

  if (loading && !data) return <Spinner label="Loading audience" />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const precisionKm = Math.round(data.precisionDeg * 111 * 10) / 10;

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

      {!data.configured && (
        <Card title="Telemetry is not configured">
          <p className="text-sm text-muted">
            Set <code className="text-ink">TELEMETRY_SALT</code> in the server environment to start
            recording. Until then the endpoint accepts pings and stores nothing.
          </p>
        </Card>
      )}

      <Card
        title="Active installs"
        subtitle={`One row per install per day. Averages are of DAILY counts — the install key rotates every day, so unique people across days cannot be counted (and are never claimed here).`}
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Active today"
            value={num(data.activePerDay.at(-1)?.n ?? 0)}
            hint="installs that opened the app"
          />
          <StatTile label="Avg daily (7d)" value={num(data.avg7d)} />
          <StatTile label="Avg daily (30d)" value={num(data.avg30d)} />
          <StatTile
            label="Reminders on"
            value={pct(data.notifEnabledPct)}
            hint="of install-days"
          />
        </div>
        <LineSeries
          data={data.activePerDay.map((d) => ({ key: d.day, value: d.n }))}
          unitLabel="daily active installs"
          emptyLabel="Nothing recorded yet — the app starts reporting from the release that added the ping."
        />
      </Card>

      {!data.empty && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Card title="App version" subtitle="How quickly testers actually upgrade">
              <CategoryBars data={data.byVersion} unitLabel="install-days" />
            </Card>
            <Card title="Platform">
              <CategoryBars data={data.byPlatform} unitLabel="install-days" />
            </Card>
            <Card title="Country">
              <CategoryBars data={data.byCountry} unitLabel="install-days" />
            </Card>
            <Card
              title="How the location was chosen"
              subtitle="'default' is the Baghdad fallback every untouched install reports — separate it out before reading the map."
            >
              <CategoryBars data={data.byLocSource} unitLabel="install-days" />
            </Card>
            <Card title="Optional features in use" subtitle="All are off by default">
              <CategoryBars
                data={data.features}
                unitLabel="install-days with the feature enabled"
                emptyLabel="No one has enabled an optional feature yet."
              />
            </Card>
            <Card title="Top areas">
              <CategoryBars
                data={data.byArea.map((a) => ({
                  key: [a.city, a.country].filter(Boolean).join(", ") || "unknown",
                  n: a.n,
                }))}
                unitLabel="install-days"
              />
            </Card>
          </div>

          <Card
            title="Where the app is used"
            subtitle={`Each point is a ~${precisionKm} km cell, rounded on the device before it is sent. Stored ${data.retentionDays} days.`}
          >
            <TileMap
              points={data.cells}
              unitLabel="install-days per cell"
              emptyLabel="No locations recorded yet."
            />
          </Card>
        </>
      )}
    </div>
  );
}
