// Auto-scrolling ("news ticker") single-line text — used for masjid names that
// don't fit their row (user, 2026-07-22: long names must scroll, not ellipsize).
//
// It only animates when the text ACTUALLY overflows: a short name renders as a
// plain span so the common case costs nothing and nothing jitters. Reduced
// motion falls back to truncation — a permanently moving label is exactly what
// that setting exists to stop.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MarqueeTextProps {
  children: string;
  className?: string;
  /** Scroll speed in px/s (the gap is crossed at this rate too). */
  speed?: number;
}

/** Gap between the text and its trailing copy, in px — must match the CSS. */
const GAP_PX = 32;
const DEFAULT_SPEED = 30;
/** Ignore sub-pixel overflow: rounding alone must not start a marquee. */
const OVERFLOW_SLOP_PX = 2;

export function MarqueeText({ children, className, speed = DEFAULT_SPEED }: MarqueeTextProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return;

    const measure = () => {
      const overflow = text.scrollWidth - viewport.clientWidth;
      setDistance(overflow > OVERFLOW_SLOP_PX ? text.scrollWidth + GAP_PX : 0);
    };
    measure();

    // Re-measure on resize/rotation and on font-size (system zoom) changes.
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [children]);

  const scrolling = distance > 0;

  return (
    <span
      ref={viewportRef}
      className={cn("relative block overflow-hidden whitespace-nowrap", className)}
      // The full name stays readable to screen readers and to copy/paste even
      // while the visible copy scrolls.
      title={children}
    >
      <span
        ref={textRef}
        className={cn("inline-block", scrolling ? "marquee-track" : "block truncate")}
        style={
          scrolling
            ? ({
                "--marquee-distance": `${distance}px`,
                "--marquee-duration": `${distance / speed}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {children}
        {scrolling && (
          <span aria-hidden="true" style={{ paddingInlineStart: GAP_PX }}>
            {children}
          </span>
        )}
      </span>
    </span>
  );
}
