// Swipeable, finger-following horizontal pager for the four keep-mounted tab
// pages (docs/V2_REDESIGN_SPEC.md Phase 3 shell + the 2026-07-19 swipe request).
// All pages stay rendered side-by-side in a translated track (never display:none
// — so state/timers survive exactly as before); the active one is shown, the
// others are clipped and marked inert + aria-hidden. A horizontal drag follows
// the finger and commits to the neighbouring tab on release (distance OR flick);
// vertical drags fall through to native scrolling (touch-action: pan-y), and a
// drag that starts inside a horizontally-scrollable child (or a [data-no-swipe]
// subtree) never hijacks it; pinch-zoom is left to the browser (pan-y pinch-zoom).
// RTL-correct: the track order mirrors the RTL tab bar, so a swipe toward a
// tab's spatial position brings it in.

import {
  Children,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { resolveSwipe, SWIPE_AXIS_LOCK_PX, SWIPE_EDGE_RESISTANCE } from "@/lib/swipe";
import { cn } from "@/lib/utils";

interface TabPagerProps {
  /** Active tab index (0-based, in logical tab order). */
  index: number;
  onChange: (index: number) => void;
  /** Gestures are ignored while an overlay (search / sheet / alarm) is open. */
  enabled: boolean;
  /** Layout classes applied to each page's scroll column. */
  pageClassName?: string;
  children: ReactNode;
}

interface DragState {
  axis: "undecided" | "horizontal" | "rejected";
  startX: number;
  startY: number;
  startT: number;
  width: number;
  pointerId: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** True if the drag started inside a horizontally-scrollable element or a
 *  [data-no-swipe] subtree — those own the horizontal gesture, not the pager.
 *  The walk STOPS at the pager's own page column ([data-pager-page]): it is a
 *  VERTICAL scroll container, but `overflow-y: auto` coerces its computed
 *  overflow-x to "auto" too (CSS spec), so under system textZoom a few px of
 *  stray horizontal overflow anywhere on the page made this guard reject EVERY
 *  drag on the tab (the real-Pixel "swipe doesn't work" report). Only elements
 *  BELOW the page column may claim the horizontal gesture. */
function isBlockedTarget(start: EventTarget | null, viewport: Element | null): boolean {
  let el = start instanceof Element ? start : null;
  while (el && el !== viewport) {
    if (el.hasAttribute("data-pager-page")) return false;
    if (el.hasAttribute("data-no-swipe")) return true;
    const ox = window.getComputedStyle(el).overflowX;
    if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth + 4) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function TabPager({ index, onChange, enabled, pageClassName, children }: TabPagerProps) {
  const items = Children.toArray(children);
  const count = items.length;

  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const idxRef = useRef(index);
  idxRef.current = index;
  const firstPaint = useRef(true);

  const dir = (): "ltr" | "rtl" =>
    document.documentElement.dir === "rtl" ? "rtl" : "ltr";
  // Track offset per index. In a natural RTL flex the columns extend to
  // NEGATIVE x in DOM order (home at x=0, times at −w, …), so advancing the
  // index moves the track RIGHT (+); LTR moves it left (−). Verified in-browser.
  const dirSign = () => (dir() === "rtl" ? 1 : -1);
  /** Logical index the drag is heading toward (for end-of-range rubber-band). */
  const dragTarget = (dx: number) => idxRef.current + dirSign() * Math.sign(dx);

  const setTransform = (px: number, animate: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    const move = animate && !prefersReducedMotion();
    track.style.transition = move ? "transform 300ms var(--ease-standard)" : "none";
    track.style.transform = `translateX(${px}px)`;
  };

  // Fractional width (NOT clientWidth, which rounds to an integer): the pages
  // are laid out at width/count of the true track width, so integer multiples
  // drift by up to a few px at the far indices on fractional-width viewports —
  // enough to show a sliver of the neighbouring page.
  const viewportWidth = () => viewportRef.current?.getBoundingClientRect().width ?? 0;

  const basePx = () => dirSign() * idxRef.current * viewportWidth();

  // Position the track for the committed index. First paint jumps (no initial
  // slide flash); later index changes — from taps OR commits — animate.
  useLayoutEffect(() => {
    setTransform(basePx(), !firstPaint.current);
    firstPaint.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count]);

  // Keep the offset correct across viewport-width changes (rotation / resize).
  useLayoutEffect(() => {
    const onResize = () => setTransform(basePx(), false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || e.pointerType === "mouse") return;
    // A second finger must never restart or hijack the gesture in flight.
    if (drag.current) return;
    if (isBlockedTarget(e.target, viewportRef.current)) return;
    drag.current = {
      axis: "undecided",
      startX: e.clientX,
      startY: e.clientY,
      startT: e.timeStamp,
      width: viewportWidth(),
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.axis === "undecided") {
      if (Math.abs(dx) < SWIPE_AXIS_LOCK_PX && Math.abs(dy) < SWIPE_AXIS_LOCK_PX) return;
      d.axis = Math.abs(dy) > Math.abs(dx) ? "rejected" : "horizontal";
      if (d.axis === "horizontal") {
        try {
          viewportRef.current?.setPointerCapture(d.pointerId);
        } catch {
          // pointer may already be released — capture is a nicety, not required
        }
      }
    }
    if (d.axis !== "horizontal" || prefersReducedMotion()) return;

    // Follow the finger; rubber-band when dragging past the first/last tab.
    const target = dragTarget(dx);
    const atEdge = target < 0 || target > count - 1;
    const eff = atEdge ? dx * SWIPE_EDGE_RESISTANCE : dx;
    setTransform(dirSign() * idxRef.current * d.width + eff, false);
  };

  /** `commit=false` on pointercancel: the browser took the gesture over
   *  (vertical scroll won a diagonal drag, pinch, system gesture) — an aborted
   *  drag must spring back, never switch tabs. */
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return; // stray extra finger — not ours
    drag.current = null;
    if (d.axis !== "horizontal") return;
    try {
      viewportRef.current?.releasePointerCapture(d.pointerId);
    } catch {
      // capture may already be gone (pointercancel) — ignore
    }
    const delta =
      commit && enabled // an overlay that opened mid-drag also voids the commit
        ? resolveSwipe(
            e.clientX - d.startX,
            e.clientY - d.startY,
            e.timeStamp - d.startT,
            d.width,
            dir(),
          )
        : 0;
    const next = Math.max(0, Math.min(count - 1, idxRef.current + delta));
    if (next !== idxRef.current) onChange(next); // index change animates via layout effect
    else setTransform(basePx(), true); // no commit → spring back
  };

  return (
    <div
      ref={viewportRef}
      className="relative min-h-0 flex-1 overflow-hidden"
      // pinch-zoom stays allowed (a11y): a pinch fires pointercancel, which
      // aborts any in-flight drag above instead of committing it.
      style={{ touchAction: "pan-y pinch-zoom" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, true)}
      onPointerCancel={(e) => endDrag(e, false)}
    >
      <div ref={trackRef} className="flex h-full" style={{ width: `${count * 100}%` }}>
        {items.map((child, i) => (
          <div
            key={i}
            data-pager-page
            // touch-action MUST be pan-y HERE, on the vertical scroll container the
            // finger actually lands on: this column is where the browser evaluates
            // the gesture, and its default `auto` let Chromium (Android WebView)
            // grab horizontal drags and fire pointercancel ~15px in — the swipe
            // could never commit (Pixel dispatch-log confirmed). pan-y = only
            // vertical panning is the browser's; horizontal is delivered to the
            // pager. pinch-zoom kept for a11y. The viewport's touch-action alone
            // was useless because the touch never starts on it. overflow-x-hidden:
            // overflow-y-auto coerces overflow-x to "auto"; keep it vertical-only.
            className={cn(
              "h-full shrink-0 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain",
              pageClassName,
            )}
            style={{ width: `${100 / count}%` }}
            inert={i !== index ? true : undefined}
            aria-hidden={i !== index ? true : undefined}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
