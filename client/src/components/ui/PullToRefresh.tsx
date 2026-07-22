// Pull-to-refresh for a tab page (user, 2026-07-22: "swiping down while in the
// tab should refresh the nearest masjids").
//
// Pages live inside TabPager's horizontal track, so this must be a good citizen:
// the gesture only arms at scrollTop 0, gives the horizontal axis back to the
// pager (lib/pull-to-refresh decides), and preventDefault()s only while it truly
// owns the drag — which is why the listeners are non-passive.

import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  canStartPull,
  IDLE_PULL,
  nextPullState,
  PULL_THRESHOLD_PX,
  shouldRefresh,
  type PullState,
} from "@/lib/pull-to-refresh";

interface PullToRefreshProps {
  /** Runs on commit; the spinner shows until it settles. */
  onRefresh: () => void | Promise<unknown>;
  /** Off-tab pages must not react to stray touches. */
  enabled?: boolean;
}

/** Minimum spinner time — an instant flash reads as "nothing happened". */
const MIN_SPIN_MS = 450;

export function PullToRefresh({ onRefresh, enabled = true }: PullToRefreshProps) {
  const { t } = useI18n();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState<PullState>(IDLE_PULL);
  const [refreshing, setRefreshing] = useState(false);

  // Effect deps stay stable (the handlers are bound once) while still seeing
  // fresh values — re-binding non-passive listeners mid-gesture loses the drag.
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const scroller = anchorRef.current?.closest<HTMLElement>("[data-pager-page]");
    if (!scroller || !enabled) return;

    let state = IDLE_PULL;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const reset = () => {
      tracking = false;
      state = IDLE_PULL;
      setPull(IDLE_PULL);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      if (!canStartPull(scroller.scrollTop)) return;
      tracking = true;
      state = IDLE_PULL;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      state = nextPullState(state, dx, dy);
      if (state.phase === "rejected") {
        reset();
        return;
      }
      if (state.phase === "pulling") {
        // We own this drag now: stop the scroller from rubber-banding under it.
        if (e.cancelable) e.preventDefault();
        setPull(state);
      }
    };

    const onTouchEnd = () => {
      if (!tracking) return;
      const commit = shouldRefresh(state);
      reset();
      if (!commit || refreshingRef.current) return;

      refreshingRef.current = true;
      setRefreshing(true);
      const started = performance.now();
      void Promise.resolve(onRefreshRef.current())
        .catch(() => undefined) // the section itself surfaces failures
        .then(() => {
          const wait = Math.max(0, MIN_SPIN_MS - (performance.now() - started));
          window.setTimeout(() => {
            refreshingRef.current = false;
            setRefreshing(false);
          }, wait);
        });
    };

    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });
    scroller.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", reset);
    };
  }, [enabled]);

  const offset = refreshing ? PULL_THRESHOLD_PX : pull.offset;
  const visible = refreshing || pull.phase === "pulling";
  const ready = pull.offset >= PULL_THRESHOLD_PX;

  return (
    <div ref={anchorRef} className="pointer-events-none relative h-0">
      <div
        className={cn(
          "absolute inset-x-0 top-0 flex flex-col items-center gap-1 transition-opacity",
          visible ? "opacity-100" : "opacity-0",
        )}
        style={{ transform: `translateY(${offset - 34}px)` }}
        aria-hidden={!visible}
      >
        <span className="grid size-8 place-items-center rounded-full border border-border-soft bg-surface text-teal shadow-sm">
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowDown
              className={cn(
                "size-4 transition-transform duration-200",
                ready && "rotate-180",
              )}
            />
          )}
        </span>
        <span className="text-[11px] text-ink-faint">
          {refreshing ? t("ptr.refreshing") : ready ? t("ptr.release") : t("ptr.pull")}
        </span>
      </div>
      {/* Announce completion for screen readers (the visual spinner is enough
          for everyone else). */}
      <span className="sr-only" role="status">
        {refreshing ? t("ptr.refreshing") : ""}
      </span>
    </div>
  );
}
