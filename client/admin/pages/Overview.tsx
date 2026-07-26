import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { duration, num, relative, timestamp } from "../lib/format";
import { Badge, Card, ErrorNote, Spinner, StatTile } from "../components/ui";

const REFRESH_MS = 30_000;

export function Overview() {
  const { data, error, loading, reload } = useApi(() => api.overview(), REFRESH_MS);

  if (loading && !data) return <Spinner label="Loading overview" />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { server, db, counts, scheduler, places, audience, flags } = data;
  const capUsedPct = places ? Math.round((places.usedThisMonth / Math.max(1, places.monthlyCap)) * 100) : 0;

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={`Refresh failed: ${error}`} onRetry={reload} />}

      <Card
        title="Service"
        subtitle={`v${server.version} · node ${server.nodeVersion} · ${server.env}`}
        actions={
          <Badge tone={db.status === "up" ? "ok" : db.status === "down" ? "danger" : "warn"}>
            db {db.status}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Uptime" value={duration(server.uptimeSec)} hint={timestamp(server.startedAt)} />
          <StatTile label="Memory" value={`${num(server.rssMb)} MB`} hint="resident set size" />
          <StatTile
            label="DB latency"
            value={`${num(db.latencyMs)} ms`}
            tone={db.latencyMs > 500 ? "warn" : "default"}
          />
          <StatTile
            label="Pending masjids"
            value={num(counts.contributionsPending)}
            tone={counts.contributionsPending > 0 ? "warn" : "default"}
            hint={counts.contributionsPending > 0 ? "waiting for review" : "queue clear"}
          />
        </div>
      </Card>

      <Card
        title="Audience"
        subtitle="Averages of DAILY ACTIVES — not unique people. The install hash rotates every day by design, so cross-day uniques cannot be computed."
      >
        {flags.telemetryEnabled ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Active today" value={num(audience.activeToday)} />
            <StatTile label="Yesterday" value={num(audience.activeYesterday)} />
            <StatTile label="Avg daily (7d)" value={num(audience.avg7d)} />
            <StatTile label="Avg daily (30d)" value={num(audience.avg30d)} />
          </div>
        ) : (
          <p className="text-sm text-muted">
            Telemetry is off — set <code className="text-ink">TELEMETRY_SALT</code> to start
            recording anonymous daily actives.
          </p>
        )}
      </Card>

      <Card title="Reminders" subtitle="Web-push subscribers and the delivery scheduler">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Subscribers" value={num(counts.subscriptions)} />
          <StatTile label="Alert rules" value={num(counts.alertRules)} />
          <StatTile
            label="Sent today"
            value={scheduler ? num(scheduler.sentToday) : "—"}
            hint={scheduler?.lastTickAt ? `last tick ${relative(scheduler.lastTickAt)}` : undefined}
          />
          <StatTile
            label="Failed today"
            value={scheduler ? num(scheduler.failedToday) : "—"}
            tone={scheduler && scheduler.failedToday > 0 ? "danger" : "default"}
          />
        </div>
        {!scheduler && (
          <p className="mt-3 text-xs text-muted">
            {flags.pushEnabled
              ? "Scheduler counters arrive with the next deploy."
              : "Push sending is disabled (no VAPID keys configured)."}
          </p>
        )}
      </Card>

      <Card
        title="Masjid data & Google spend"
        subtitle={places ? `Billing day ${places.billingDay} (Pacific — Google's reset zone)` : undefined}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Masjids (OSM)" value={num(counts.masjidsResident)} />
          <StatTile
            label="Masjids (community)"
            value={num(counts.masjidsCommunity)}
            hint="approved contributions"
          />
          <StatTile
            label="Units this month"
            value={places ? `${num(places.usedThisMonth)} / ${num(places.monthlyCap)}` : "—"}
            tone={capUsedPct >= 80 ? "danger" : capUsedPct >= 50 ? "warn" : "ok"}
            hint={places ? `${capUsedPct}% of the self-imposed cap` : undefined}
          />
          <StatTile
            label="Today's pool"
            value={places ? num(places.dailyPool) : "—"}
            hint={places ? `${num(places.activeClients)} active clients` : undefined}
          />
        </div>
        {!flags.placesEnabled && (
          <p className="mt-3 text-xs text-muted">
            Places proxy is disabled (no Google Maps API key) — masjid search serves the offline
            dataset only.
          </p>
        )}
      </Card>
    </div>
  );
}
