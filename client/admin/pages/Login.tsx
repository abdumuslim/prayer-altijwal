import { useState, type FormEvent } from "react";
import { AdminApiError, api } from "../lib/api";
import { Button, Field, inputClass } from "../components/ui";

/**
 * The whole gate. One password, no username — there is exactly one operator.
 * The server answers wrong passwords with a generic message and locks the
 * caller out after five tries, so nothing here hints at what went wrong.
 */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      setPassword("");
      onSuccess();
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 429) {
        const wait = err.retryAfterSec ? `${Math.ceil(err.retryAfterSec / 60)} min` : "a while";
        setError(`Too many attempts — locked for ${wait}.`);
      } else if (err instanceof AdminApiError && err.status === 0) {
        setError("Cannot reach the server.");
      } else {
        setError("Invalid credentials.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-6"
      >
        <h1 className="text-base font-semibold text-ink">Prayer Admin</h1>
        <p className="mt-1 mb-5 text-xs text-muted">prayer.altijwal.com — operator access</p>

        <Field label="Password">
          <input
            type="password"
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </Field>

        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="mt-5">
          <Button type="submit" variant="primary" disabled={busy || !password}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
        </div>
      </form>
    </main>
  );
}
