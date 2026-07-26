import type { ReactNode } from "react";

/**
 * Shared primitives for the dashboard. Deliberately small and in one file:
 * these are layout atoms, not a design system, and splitting eight ten-line
 * components across eight files would cost more than it explains.
 */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx("rounded-xl border border-line bg-surface p-4 sm:p-5", className)}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs leading-snug text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cx("tnum mt-1 text-xl font-semibold leading-none", toneClass)}>{value}</div>
      {hint && <div className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "default",
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium " +
    "transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    default: "border border-line bg-surface-2 text-ink hover:bg-line",
    primary: "bg-accent text-bg hover:brightness-110",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
    ghost: "text-muted hover:text-ink",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(base, variants[variant])}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink " +
  "placeholder:text-muted/60 focus:border-accent focus:outline-none";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted" role="status">
      <span
        aria-hidden
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent"
      />
      {label}…
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      <span className="min-w-0 break-words">{message}</span>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const tones = {
    default: "border-line text-muted",
    ok: "border-ok/40 text-ok",
    warn: "border-warn/40 text-warn",
    danger: "border-danger/40 text-danger",
  } as const;
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
