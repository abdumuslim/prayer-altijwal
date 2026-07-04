// A small accessible on/off switch (role="switch"). Emerald track when on,
// muted when off, with a knob that slides to the inline-end. RTL-aware: the
// knob rests at the inline-start and travels toward the inline-end in both
// directions. The accessible name comes from the row label via `labelId`.

import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** id of the visible label element that names this switch. */
  labelId: string;
}

export function Toggle({ checked, onChange, labelId }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald/50",
        checked
          ? "border-emerald/60 bg-emerald/80"
          : "border-border-soft bg-white/[0.06]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute start-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "ltr:translate-x-5 rtl:-translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
