import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { num, timestamp } from "../lib/format";
import { Badge, Card, ErrorNote, Spinner, cx, inputClass } from "../components/ui";

const REFRESH_MS = 10_000;

/**
 * Recent warnings and errors, straight from the in-process ring buffer.
 *
 * This is a convenience view, not the log: stdout is still the record, the
 * buffer holds a few hundred entries, and a restart empties it. The card says
 * so rather than letting an empty page imply "nothing went wrong".
 */
export function Logs() {
  const [level, setLevel] = useState<"warn" | "error">("warn");
  const [component, setComponent] = useState("");

  const fetcher = useCallback(
    () => api.logs(level, component || undefined),
    [level, component],
  );
  const { data, error, loading, reload } = useApi(fetcher, REFRESH_MS);

  return (
    <div className="space-y-4">
      <Card
        title="Server log"
        subtitle={
          data
            ? `In-memory ring of the last ${num(data.capacity)} warnings and errors. Cleared on restart — stdout remains the real log.`
            : undefined
        }
        actions={
          <span className="text-xs text-muted">auto-refresh 10s</span>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex gap-2">
            {(["warn", "error"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                aria-current={level === l ? "true" : undefined}
                className={cx(
                  "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  level === l
                    ? "border-accent/50 bg-surface-2 font-medium text-ink"
                    : "border-line text-muted hover:text-ink",
                )}
              >
                {l === "warn" ? "Warnings + errors" : "Errors only"}
              </button>
            ))}
          </div>
          <label className="min-w-[12rem]">
            <span className="mb-1 block text-xs text-muted">Component</span>
            <select
              className={inputClass}
              value={component}
              onChange={(e) => setComponent(e.target.value)}
            >
              <option value="">All</option>
              {(data?.components ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading log" />}

      {data && data.items.length === 0 && (
        <Card>
          <p className="py-4 text-center text-sm text-muted">
            Nothing logged at this level since the last restart. That is good news.
          </p>
        </Card>
      )}

      {data && data.items.length > 0 && (
        <Card>
          <ul className="divide-y divide-line p-0">
            {data.items.map((e, i) => (
              <li key={`${e.at}-${i}`} className="list-none py-2.5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={e.level === "warn" ? "warn" : "danger"}>{e.level}</Badge>
                  <span className="font-mono text-xs text-accent">{e.component}</span>
                  <span className="tnum text-xs text-muted">{timestamp(e.at)}</span>
                </div>
                <p className="mt-1 break-words text-sm text-ink">{e.msg}</p>
                {e.err && (
                  <p className="mt-0.5 break-words font-mono text-xs text-danger">{e.err}</p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
