/**
 * In-memory ring of recent warnings and errors, so the operator dashboard can
 * answer "what just broke" without an SSH session and `docker compose logs`.
 *
 * Deliberately memory-only: it resets on restart and holds a few hundred
 * entries. stdout remains the real log — this is a convenience view, and the
 * UI says so.
 *
 * Everything here runs on the logging path, so it must never throw: a
 * malformed line is dropped, not surfaced.
 */

export const RING_CAPACITY = 500;
const MAX_FIELD_LENGTH = 500;

export interface LogEntry {
  at: string;
  level: "warn" | "error" | "fatal";
  component: string;
  msg: string;
  err?: string;
}

export interface LogFilter {
  level?: "warn" | "error";
  component?: string;
  limit?: number;
}

const ring: LogEntry[] = [];

/**
 * Literal secret values to scrub. Registered from index.ts AFTER config loads —
 * logger.ts cannot import config.ts, which imports logger.ts.
 */
let secrets: string[] = [];

export function registerRedactedSecrets(values: (string | undefined)[]): void {
  // Longest first, so a value that contains another is replaced whole.
  secrets = values
    .filter((v): v is string => typeof v === "string" && v.length >= 8)
    .sort((a, b) => b.length - a.length);
}

/** Connection strings arrive inside pg error messages, password and all. */
const DSN_PASSWORD = /(postgres(?:ql)?:\/\/[^:@\s"/]+):([^@\s"]+)@/gi;
/** Coordinates must not accumulate in logs (Play Data Safety: ephemeral). */
const COORD_FIELD = /"(lat|lon|latitude|longitude)"\s*:\s*-?\d+(?:\.\d+)?/gi;

/** Applied to the RAW serialized line, so nesting and unknown shapes are covered. */
export function redact(line: string): string {
  let out = line.replace(DSN_PASSWORD, "$1:[redacted]@").replace(COORD_FIELD, '"$1":"[redacted]"');
  for (const secret of secrets) {
    if (secret && out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function levelName(level: unknown): LogEntry["level"] | null {
  const n = Number(level);
  if (n >= 60) return "fatal";
  if (n >= 50) return "error";
  if (n >= 40) return "warn";
  return null; // info/debug never reach the ring
}

function truncate(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return s.length > MAX_FIELD_LENGTH ? `${s.slice(0, MAX_FIELD_LENGTH)}…` : s;
}

/** Parse one serialized pino line into a ring entry. Returns null if unusable. */
export function parseLine(line: string): LogEntry | null {
  try {
    const record = JSON.parse(redact(line)) as Record<string, unknown>;
    const level = levelName(record.level);
    if (!level) return null;

    const err = record.err as { message?: string; type?: string } | undefined;
    const entry: LogEntry = {
      at: new Date(Number(record.time) || Date.now()).toISOString(),
      level,
      component: typeof record.component === "string" ? record.component : "app",
      msg: truncate(record.msg ?? ""),
    };
    if (err && (err.message || err.type)) {
      entry.err = truncate(err.message ?? err.type ?? "");
    }
    return entry;
  } catch {
    return null;
  }
}

export function pushLine(line: string): void {
  const entry = parseLine(line);
  if (!entry) return;
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.splice(0, ring.length - RING_CAPACITY);
}

/** Newest first. */
export function getRecentLogs(filter: LogFilter = {}): LogEntry[] {
  const limit = Math.min(Math.max(1, Math.floor(filter.limit ?? 200)), RING_CAPACITY);
  let items = ring;
  if (filter.level === "error") items = items.filter((e) => e.level !== "warn");
  if (filter.component) items = items.filter((e) => e.component === filter.component);
  return items.slice(-limit).reverse();
}

/** Distinct components present in the buffer, for the UI's filter dropdown. */
export function bufferedComponents(): string[] {
  return [...new Set(ring.map((e) => e.component))].sort();
}

export function bufferSize(): number {
  return ring.length;
}

/** Tests only. */
export function clearBuffer(): void {
  ring.length = 0;
}

/** Writable-ish sink for pino.multistream. */
export const ringStream = {
  write(chunk: string): void {
    // pino can hand over several newline-delimited records at once.
    for (const line of chunk.split("\n")) {
      if (line.trim()) pushLine(line);
    }
  },
};
