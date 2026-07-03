// The fard check-in control: a small icon after the prayer name on each card.
// Unmarked-passed = subtle dashed circle; marked = the state's coloured icon.
// Tapping opens a 3-icon popover (masjid/home/missed); tapping a marked icon
// also shows a transient tooltip naming the state and its points. Selecting
// the current state again undoes it (back to unmarked). Least-distraction by
// design: icons only, meaning taught by the tooltip.

import { useEffect, useRef, useState, type ElementType } from "react";
import { Home, X } from "lucide-react";
import { MosqueIcon } from "@/components/ui/MosqueIcon";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import type { FardState } from "@/lib/worship-log";
import type { StringKey } from "@/i18n/strings.en";

export interface CheckinTone {
  icon: ElementType;
  labelKey: StringKey;
  tipKey: StringKey;
  cls: string;
}

/** Shared visual language for the three states (cards, hero row, sheets). */
export const CHECKIN_TONES: Record<Exclude<FardState, "unmarked">, CheckinTone> = {
  masjid: { icon: MosqueIcon, labelKey: "track.masjid", tipKey: "track.inMasjid", cls: "border-gold/60 bg-gold/10 text-gold" },
  home: { icon: Home, labelKey: "track.home", tipKey: "track.atHome", cls: "border-teal/60 bg-teal/10 text-teal" },
  missed: { icon: X, labelKey: "track.missed", tipKey: "track.missedTip", cls: "border-critical/50 bg-critical/10 text-critical" },
};

export const CHECKIN_ORDER = ["masjid", "home", "missed"] as const;

/** Transient text that auto-hides (tooltip semantics). */
export function useTransientText(ms = 2500): [string | null, (t: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );
  const show = (t: string) => {
    setText(t);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setText(null), ms);
  };
  return [text, show];
}

export function TransientTip({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute z-30 whitespace-nowrap rounded-lg border border-border bg-night px-2 py-1",
        "animate-fade-in text-[11px] font-bold leading-none text-ink shadow-xl",
        className,
      )}
    >
      {text}
    </span>
  );
}

/** The 3 state choices as icon-only round buttons (hero row + card popover). */
export function CheckinIconTrio({
  size = "md",
  current,
  onPick,
}: {
  size?: "sm" | "md";
  current: FardState;
  onPick: (state: Exclude<FardState, "unmarked">) => void;
}) {
  const { t } = useI18n();
  const btn = size === "md" ? "size-10" : "size-8";
  const icon = size === "md" ? "size-5" : "size-4";
  return (
    <div className={cn("flex items-center justify-center", size === "md" ? "gap-3" : "gap-1.5")}>
      {CHECKIN_ORDER.map((k) => {
        const tone = CHECKIN_TONES[k];
        const Icon = tone.icon;
        return (
          <button
            key={k}
            type="button"
            aria-label={t(tone.labelKey)}
            onClick={(e) => {
              e.stopPropagation();
              onPick(k);
            }}
            className={cn(
              "grid place-items-center rounded-full border transition-transform active:scale-90",
              btn,
              tone.cls,
              current === k && "ring-2 ring-current",
            )}
          >
            <Icon className={icon} />
          </button>
        );
      })}
    </div>
  );
}

interface CheckinControlProps {
  state: FardState;
  /** The mark window is open (adhan passed, still today). */
  enabled: boolean;
  onMark: (state: FardState) => void;
}

export function CheckinControl({ state, enabled, onMark }: CheckinControlProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tip, showTip] = useTransientText();
  const rootRef = useRef<HTMLSpanElement>(null);

  // Close the popover on outside tap / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (state === "unmarked" && !enabled) return null;

  const tone = state !== "unmarked" ? CHECKIN_TONES[state] : null;
  const Icon = tone?.icon;

  const pick = (k: Exclude<FardState, "unmarked">) => {
    if (k === state) {
      onMark("unmarked"); // tapping the current state again undoes it
      showTip(t("track.logPrayer"));
    } else {
      onMark(k);
      showTip(t(CHECKIN_TONES[k].tipKey));
    }
    setOpen(false);
  };

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      {tone && Icon ? (
        <button
          type="button"
          aria-label={t(tone.tipKey)}
          onClick={() => {
            showTip(t(tone.tipKey));
            if (enabled) setOpen((o) => !o);
          }}
          className={cn("grid size-6 place-items-center rounded-full border", tone.cls)}
        >
          <Icon className="size-3.5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label={t("track.logPrayer")}
          onClick={() => setOpen((o) => !o)}
          className="size-6 rounded-full border-2 border-dashed border-warning/60 transition-colors hover:border-warning"
        />
      )}
      {tip && <TransientTip text={tip} className="-top-9 left-1/2 -translate-x-1/2" />}
      {open && (
        <span className="card absolute -top-12 left-0 z-30 flex items-center rounded-xl px-1.5 py-1.5">
          <CheckinIconTrio size="sm" current={state} onPick={pick} />
        </span>
      )}
    </span>
  );
}
