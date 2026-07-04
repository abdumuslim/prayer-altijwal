// The fard check-in control: a small icon after the prayer name on each card.
// Unmarked-passed = subtle dashed circle; marked = the state's coloured icon.
// Tapping opens a 3-icon popover (masjid/home/missed) centred on the icon, with
// the page dimmed behind it — the icon and popover stay lit. Selecting the
// current state again undoes it. Least-distraction by design: icons only,
// meaning taught by the transient tooltip shown after a pick.
//
// The popover is PORTALED to <body>: the prayer-list card sets backdrop-filter
// and a retained rise-in transform, both of which trap `position: fixed` and cap
// z-index — so an in-card overlay could never dim the whole page or sit above it.

import { useEffect, useRef, useState, type ElementType } from "react";
import { createPortal } from "react-dom";
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

/** Fixed size of the trio popover (3× size-8 buttons + gaps + padding + border). */
const POP_W = 122;
const POP_H = 46;

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

/** The small round trigger icon — state's coloured icon, or a dashed placeholder. */
function TriggerButton({
  tone,
  onClick,
}: {
  tone: CheckinTone | null;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const Icon = tone?.icon;
  if (tone && Icon) {
    return (
      <button
        type="button"
        aria-label={t(tone.tipKey)}
        onClick={onClick}
        className={cn("grid size-6 place-items-center rounded-full border", tone.cls)}
      >
        <Icon className="size-3.5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={t("track.logPrayer")}
      onClick={onClick}
      className="size-6 rounded-full border-2 border-dashed border-warning/60 transition-colors hover:border-warning"
    />
  );
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
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
  const [rect, setRect] = useState<Rect | null>(null);
  const [tip, showTip] = useTransientText();
  const rootRef = useRef<HTMLSpanElement>(null);

  // While open: Escape closes; lock body scroll and close on resize — the popover
  // is positioned from a rect measured once at open time, so a scroll/resize
  // would otherwise detach it from the icon.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (state === "unmarked" && !enabled) return null;

  const tone = state !== "unmarked" ? CHECKIN_TONES[state] : null;

  const openPopover = () => {
    if (!enabled) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    setOpen(true);
  };

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

  // Popover placement: horizontally centred on the icon, clamped to the viewport,
  // flipped below when the icon sits too close to the top.
  const pos = rect
    ? {
        left: Math.min(
          Math.max(8, rect.left + rect.width / 2 - POP_W / 2),
          window.innerWidth - POP_W - 8,
        ),
        top: rect.top >= POP_H + 16 ? rect.top - POP_H - 8 : rect.top + rect.height + 8,
      }
    : null;

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0">
      <TriggerButton tone={tone} onClick={() => (open ? setOpen(false) : openPopover())} />
      {tip && !open && <TransientTip text={tip} className="-top-9 left-1/2 -translate-x-1/2" />}
      {open &&
        rect &&
        pos &&
        createPortal(
          <div className="fixed inset-0 z-40">
            {/* Dim the whole page; a tap anywhere closes. */}
            <div
              className="animate-overlay-in absolute inset-0 bg-black/60 backdrop-blur-[2px]"
              onPointerDown={() => setOpen(false)}
              aria-hidden="true"
            />
            {/* Pixel-identical clone of the trigger, above the backdrop so the
                source icon reads as "still lit". pointer-events-none → a tap on it
                falls through to the backdrop and closes. */}
            <div
              className="pointer-events-none fixed"
              style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
              aria-hidden="true"
            >
              <TriggerButton tone={tone} />
            </div>
            {/* The 3-icon trio, centred on the icon and clamped on-screen. */}
            <span
              className="card fixed z-10 flex items-center rounded-xl px-1.5 py-1.5"
              style={{ top: pos.top, left: pos.left }}
            >
              <CheckinIconTrio size="sm" current={state} onPick={pick} />
            </span>
          </div>,
          document.body,
        )}
    </span>
  );
}
