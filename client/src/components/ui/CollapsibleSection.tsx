// A collapsible Settings section: a full-width header (icon tile + title/subtitle
// + chevron) that expands/collapses its body. Collapsed by default so the panel
// opens as a compact list of section headers. The body stays MOUNTED while
// collapsed (only clipped) — sections rely on their effects running (e.g. the
// reminders section seeds a default rule on first subscribe), so it must not
// unmount. Height animates via the grid-template-rows 0fr↔1fr trick, which works
// with dynamic content (rule lists grow, forms expand inline).

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  /** Lucide icon element rendered inside the colored tile. */
  icon: ReactNode;
  /** Tile color utilities, e.g. "bg-gold/10 text-gold". */
  iconClass: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  /** Controlled mode (with onToggle) — lets callers gate lazy work on `open`
   *  (e.g. the Times month table fetches only while its section is open). */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

export function CollapsibleSection({
  icon,
  iconClass,
  title,
  subtitle,
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const [uncontrolledOpen, setOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const bodyId = useId();

  return (
    <section className="rounded-2xl border border-border-soft/70 bg-veil/[0.015]">
      <button
        type="button"
        onClick={() => {
          if (onToggle) onToggle(!open);
          else setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-2.5 rounded-2xl px-3 py-3 text-start transition-colors hover:bg-veil/[0.02]"
      >
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", iconClass)}>
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-bold text-ink">{title}</span>
          {subtitle && <span className="truncate text-xs text-ink-dim">{subtitle}</span>}
        </span>
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-ink-dim transition-transform duration-300",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={bodyId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-3 pb-3.5 pt-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
