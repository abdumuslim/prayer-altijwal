/**
 * Defensive local crash/error ring buffer (no third-party service).
 *
 * A single localStorage key holds the newest ~50 records so a tester's problem
 * leaves a trace we can pull off the device, without shipping any analytics SDK.
 * Every read and write is wrapped: the recorder must NEVER throw, since it is
 * called from the global error/unhandledrejection handlers and the React error
 * boundary, where a throw would either loop or mask the original failure.
 *
 * Structure follows lib/telemetry.ts: the logic (parse, append, evict, clamp)
 * lives in pure exported functions covered by error-log.test.ts, and the three
 * effectful entry points are thin shells over them (client tests run in node,
 * without a DOM).
 */

const STORAGE_KEY = "prayer.errors.v1";
/** Newest-N kept; the oldest is evicted once the buffer is full. */
const MAX_ENTRIES = 50;
/** Per-field char cap so one huge stack can't blow the storage quota. */
const MAX_FIELD_LEN = 2000;

export interface ErrorEntry {
  /** epoch ms the entry was recorded. */
  ts: number;
  /** Coarse category, e.g. "window.error", "error-boundary", "native-alarm-cap". */
  kind: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

/** Fields a caller supplies; `ts` is stamped by recordError. */
export type ErrorInput = Omit<ErrorEntry, "ts">;

/** Trim a string to the field cap (undefined passes through untouched). */
function clampField(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > MAX_FIELD_LEN ? value.slice(0, MAX_FIELD_LEN) : value;
}

/** Normalize a caller's input into a stored entry (bounded, always well-formed). */
export function toEntry(input: ErrorInput, ts: number): ErrorEntry {
  const entry: ErrorEntry = {
    ts,
    kind: String(input.kind).slice(0, MAX_FIELD_LEN),
    message: clampField(String(input.message)) ?? "",
  };
  const stack = clampField(input.stack);
  if (stack !== undefined) entry.stack = stack;
  if (input.extra !== undefined) entry.extra = input.extra;
  return entry;
}

/** Safely parse the stored buffer; anything malformed reads back as empty. */
export function parseLog(raw: string | null): ErrorEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ErrorEntry[]) : [];
  } catch {
    return [];
  }
}

/** Append one entry and evict the oldest so at most `max` are kept. */
export function appendEntry(
  log: ErrorEntry[],
  entry: ErrorEntry,
  max: number = MAX_ENTRIES,
): ErrorEntry[] {
  const next = [...log, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Record one error. Fully guarded: a storage failure (private mode, quota) or a
 * malformed input is swallowed, because a crash logger that can itself crash is
 * worse than no logger.
 */
export function recordError(input: ErrorInput): void {
  try {
    const entry = toEntry(input, Date.now());
    const next = appendEntry(parseLog(localStorage.getItem(STORAGE_KEY)), entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable / serialization failed: never let logging throw */
  }
}

/** Read the buffer back (newest last). Empty on any failure. */
export function readErrors(): ErrorEntry[] {
  try {
    return parseLog(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Clear the buffer. */
export function clearErrors(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do if storage is unavailable */
  }
}
