// Full-screen phone-style alarm. Raised (above every slide-over/sheet) when an
// alarm-kind reminder fires while the app is open, or when the app is cold-opened
// from an alarm notification (see useAlarm). Styled to read exactly like a mobile
// alarm going off: a huge live clock as the centerpiece, the prayer as the alarm
// label with a ringing icon, and a slide-to-stop control at the bottom (stop
// only — no snooze, by design). Synthesized tone + device vibration accompany it.
// Audio autoplay is best-effort: if the context is still blocked (no prior
// gesture) the first tap anywhere starts it; the visual + vibration alert
// regardless.

import { useEffect, useRef, useState } from "react";
import { AlarmClock, ChevronsUp, X } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { startAlarm, stopAlarm } from "@/lib/alarm-sound";
import { cn } from "@/lib/utils";

interface AlarmOverlayProps {
  title: string;
  body: string;
  onStop: () => void;
}

const AUTO_DISMISS_MS = 2 * 60_000; // loop the tone for 2 min, then give up if untouched
const VIBRATE_INTERVAL_MS = 2000;
const VIBRATE_PATTERN = [400, 200, 400, 200, 400];

export function AlarmOverlay({ title, body, onStop }: AlarmOverlayProps) {
  const { t, lang } = useI18n();
  const [clock, setClock] = useState(() => clockParts(lang));

  useEffect(() => {
    let started = false;

    // Best-effort audio. Browsers block audio until the page has a user gesture,
    // so a cold-opened alarm can't autoplay — retry on EVERY interaction until it
    // catches (not just once). The visual + vibration alert regardless.
    const tryStart = () => {
      if (started) return;
      void startAlarm().then((ok) => {
        if (ok) {
          started = true;
          window.removeEventListener("pointerdown", tryStart);
          window.removeEventListener("touchstart", tryStart);
          window.removeEventListener("keydown", tryStart);
        }
      });
    };
    tryStart();
    window.addEventListener("pointerdown", tryStart);
    window.addEventListener("touchstart", tryStart);
    window.addEventListener("keydown", tryStart);

    // Device vibration loop where supported (ignored on iOS / desktop).
    const canVibrate = typeof navigator !== "undefined" && "vibrate" in navigator;
    if (canVibrate) navigator.vibrate(VIBRATE_PATTERN);
    const vibrateTimer = canVibrate
      ? setInterval(() => navigator.vibrate(VIBRATE_PATTERN), VIBRATE_INTERVAL_MS)
      : null;

    const clockTimer = setInterval(() => setClock(clockParts(lang)), 1000);
    const autoDismiss = setTimeout(() => onStop(), AUTO_DISMISS_MS);

    return () => {
      stopAlarm();
      window.removeEventListener("pointerdown", tryStart);
      window.removeEventListener("touchstart", tryStart);
      window.removeEventListener("keydown", tryStart);
      if (canVibrate) navigator.vibrate(0);
      if (vibrateTimer) clearInterval(vibrateTimer);
      clearInterval(clockTimer);
      clearTimeout(autoDismiss);
    };
  }, [lang, onStop]);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="animate-overlay-in fixed inset-0 z-[100] flex flex-col items-center px-6 text-center"
      style={{
        // Token-driven so every theme (incl. light ones) restyles the alarm
        // screen — docs/V2_REDESIGN_SPEC.md §5 (user: alarm follows the theme).
        background:
          "radial-gradient(circle at 50% 32%, color-mix(in srgb, var(--color-gold) 16%, transparent), transparent 58%), var(--color-night)",
        // pt-16/pb-12 + the native safe-area insets (0 on web).
        paddingTop: "calc(4rem + var(--inset-top))",
        paddingBottom: "calc(3rem + var(--inset-bottom))",
      }}
    >
      {/* Ringing label */}
      <div className="flex items-center gap-2 text-gold">
        <AlarmClock className="alarm-pulse size-5" />
        <span className="text-sm font-semibold tracking-wide">{title}</span>
      </div>

      {/* Huge live clock — the mobile-alarm centerpiece. aria-hidden: it ticks
          every second; title + body already announce the alarm (Phase 8). */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="flex items-baseline gap-2" dir="ltr" aria-hidden="true">
          <span className="tnum text-[5.5rem] font-extrabold leading-none text-ink">
            {clock.time}
          </span>
          {clock.period && (
            <span className="text-2xl font-bold text-ink-dim">{clock.period}</span>
          )}
        </div>
        <p className="text-lg text-ink-dim">{body}</p>
      </div>

      {/* Swipe the X up to stop (no snooze) */}
      <SwipeUpToStop label={t("alarm.stop")} onStop={onStop} />
    </div>
  );
}

interface SwipeUpToStopProps {
  label: string;
  onStop: () => void;
}

const MAX_UP_PX = 150; // how far the button can travel up
const THRESHOLD_PX = 90; // travel past this → dismiss

/** Swipe-up-to-dismiss X button (pointer drag; Enter/Space keyboard fallback). */
function SwipeUpToStop({ label, onStop }: SwipeUpToStopProps) {
  const [travel, setTravel] = useState(0); // px dragged upward
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef(0);
  const doneRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    doneRef.current = false;
    startYRef.current = e.clientY;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || doneRef.current) return;
    const up = Math.max(0, Math.min(MAX_UP_PX, startYRef.current - e.clientY));
    setTravel(up);
    if (up >= THRESHOLD_PX) {
      doneRef.current = true;
      setDragging(false);
      onStop();
    }
  };

  const onPointerUp = () => {
    setDragging(false);
    if (!doneRef.current) setTravel(0);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <ChevronsUp
        className="size-6 animate-bounce text-gold/70"
        style={{ opacity: 1 - travel / MAX_UP_PX }}
      />
      <button
        type="button"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onStop();
        }}
        style={{ transform: `translateY(${-travel}px)` }}
        className={cn(
          "grid size-16 touch-none place-items-center rounded-full border border-veil/20 bg-veil/10 text-ink shadow-lg backdrop-blur-sm",
          !dragging && "transition-transform duration-200",
        )}
      >
        <X className="size-7" />
      </button>
    </div>
  );
}

/** Device-local time split into { time, period } — Latin numerals (product rule). */
function clockParts(lang: string): { time: string; period: string } {
  try {
    const parts = new Intl.DateTimeFormat(lang === "ar" ? "ar-u-nu-latn" : "en", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return { time: `${get("hour")}:${get("minute")}`, period: get("dayPeriod") };
  } catch {
    return { time: "", period: "" };
  }
}
