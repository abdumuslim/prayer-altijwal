import { useCallback, useEffect, useState } from "react";
import {
  api,
  type Contribution,
  type ContributionEdit,
  type ContributionStatus,
} from "../lib/api";
import { useApi } from "../lib/useApi";
import { num, timestamp } from "../lib/format";
import { Badge, Button, Card, EmptyState, ErrorNote, Spinner, cx, inputClass } from "../components/ui";

const STATUSES: ContributionStatus[] = ["pending", "approved", "rejected"];

/**
 * Masjid moderation — the feature that replaces hand-writing
 * `UPDATE masjid_contributions SET status='approved'` over SSH.
 *
 * An approval takes effect immediately (the server refreshes the live index
 * rather than waiting for its ten-minute poll), so the row reports how many
 * community masjids are searchable right after the click.
 */
export function Masjids({ embedKey }: { embedKey: string | null }) {
  const [status, setStatus] = useState<ContributionStatus>("pending");
  const fetcher = useCallback(() => api.contributions(status), [status]);
  const { data, error, loading, reload } = useApi(fetcher);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const moderate = useCallback(
    async (id: number, edit: ContributionEdit) => {
      const res = await api.moderate(id, edit);
      if (edit.status === "approved") {
        setToast(`Approved — ${num(res.liveCount ?? 0)} community masjids now live.`);
      } else if (edit.status) {
        setToast(`Marked ${edit.status}.`);
      } else {
        setToast("Saved.");
      }
      reload();
    },
    [reload],
  );

  return (
    <div className="space-y-4">
      <Card
        title="Masjid contributions"
        subtitle="User submissions folded into the offline dataset once approved. Approving publishes immediately."
        actions={
          <Button onClick={reload} variant="ghost">
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              aria-current={status === s ? "true" : undefined}
              className={cx(
                "rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors",
                status === s
                  ? "border-accent/50 bg-surface-2 font-medium text-ink"
                  : "border-line text-muted hover:text-ink",
              )}
            >
              {s}
              {data?.counts ? (
                <span className="tnum ms-2 text-xs text-muted">{num(data.counts[s])}</span>
              ) : null}
            </button>
          ))}
        </div>
      </Card>

      {toast && (
        <div
          role="status"
          className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok"
        >
          {toast}
        </div>
      )}
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading queue" />}

      {data && data.items.length === 0 && (
        <EmptyState>
          {status === "pending" ? "Nothing waiting for review." : `No ${status} submissions.`}
        </EmptyState>
      )}

      {data?.items.map((item) => (
        <Row key={item.id} item={item} embedKey={embedKey} onModerate={moderate} />
      ))}
    </div>
  );
}

function Row({
  item,
  embedKey,
  onModerate,
}: {
  item: Contribution;
  embedKey: string | null;
  onModerate: (id: number, edit: ContributionEdit) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [lat, setLat] = useState(String(item.lat));
  const [lon, setLon] = useState(String(item.lon));
  const [failed, setFailed] = useState<string | null>(null);

  const run = async (edit: ContributionEdit) => {
    setBusy(true);
    setFailed(null);
    try {
      await onModerate(item.id, edit);
      setEditing(false);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = () => {
    const nextLat = Number(lat);
    const nextLon = Number(lon);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLon)) {
      setFailed("Coordinates must be numbers.");
      return;
    }
    void run({ name: name.trim(), lat: nextLat, lon: nextLon });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* Submissions are Arabic; render them RTL inside an LTR page. */}
            <h3 dir="rtl" className="text-base font-medium text-ink">
              {item.name}
            </h3>
            <Badge tone={item.status === "approved" ? "ok" : item.status === "rejected" ? "danger" : "warn"}>
              {item.status}
            </Badge>
            {item.duplicate && <Badge tone="danger">possible duplicate</Badge>}
          </div>
          <p className="tnum mt-1 text-xs text-muted">
            #{item.id} · {item.lat.toFixed(5)}, {item.lon.toFixed(5)} · {timestamp(item.createdAt)}
            {item.clientShort ? ` · client ${item.clientShort}` : ""}
          </p>
          {item.nearest && (
            <p className="mt-1 text-xs text-muted">
              Nearest known masjid:{" "}
              <span dir="rtl" className="text-ink">
                {item.nearest.name}
              </span>{" "}
              <span className="tnum">({num(item.nearest.distanceM)} m away)</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {item.status !== "approved" && (
            <Button variant="primary" disabled={busy} onClick={() => void run({ status: "approved" })}>
              Approve
            </Button>
          )}
          {item.status !== "rejected" && (
            <Button variant="danger" disabled={busy} onClick={() => void run({ status: "rejected" })}>
              Reject
            </Button>
          )}
          {item.status !== "pending" && (
            <Button disabled={busy} onClick={() => void run({ status: "pending" })} title="Move back to the queue">
              Undo
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>

      {failed && (
        <p role="alert" className="mt-3 text-xs text-danger">
          {failed}
        </p>
      )}

      {editing && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="sm:col-span-3">
            <span className="mb-1 block text-xs text-muted">Name</span>
            <input dir="rtl" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Latitude</span>
            <input className={cx(inputClass, "tnum")} value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">Longitude</span>
            <input className={cx(inputClass, "tnum")} value={lon} onChange={(e) => setLon(e.target.value)} />
          </label>
          <div className="flex items-end">
            <Button variant="primary" disabled={busy} onClick={saveEdit}>
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4">
        {embedKey ? (
          <iframe
            title={`Map for ${item.name}`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="h-56 w-full rounded-lg border border-line"
            src={`https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(embedKey)}&q=${item.lat},${item.lon}&zoom=17`}
          />
        ) : (
          <a
            className="text-sm text-accent underline"
            href={`https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lon}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open in Google Maps
          </a>
        )}
      </div>
    </Card>
  );
}
