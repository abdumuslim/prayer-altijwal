// Qibla compass card (docs/QIBLA_MASJID_SPEC.md §5e). A modern compass dial: a
// rotating rose (ticks + UPRIGHT cardinal letters) driven by the accuracy-chain
// heading (hooks/useCompassHeading) with a clear arrow needle pointing at the
// Kaaba. It never rotates from relative sensors; without an absolute source it
// degrades to STATIC guidance (fixed dial, arrow at the true bearing, "point
// north then follow the arrow"). Styled through semantic tokens only (4 themes).
//
// Start flow: on native + Android-web it auto-starts (TimesPage effect) and
// never prompts; only iOS-web keeps the «ابدأ البوصلة» button (its motion
// permission must be requested inside a tap).

import { useEffect, useRef, useState } from "react";
import { Compass as CompassIcon, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { CompassAccuracy, UseCompassHeading } from "@/hooks/useCompassHeading";
import { bearingToKaaba, distanceToKaabaKm } from "@/lib/qibla";
import { shortestDelta, smoothingFactor, stepAngle } from "@/lib/heading-anim";
import { Compass, isNative } from "@/lib/native";
import { cn } from "@/lib/utils";
import { MosqueIcon } from "@/components/ui/MosqueIcon";
import type { StoredLocation } from "@/lib/storage";

interface QiblaCompassProps {
  location: StoredLocation;
  /** Shared heading state — owned by TimesPage so the masjid arrows reuse it. */
  compass: UseCompassHeading;
}

/** Lock-on window around the exact bearing (spec: ±3°). */
const ALIGN_DEG = 3;
/** Easing time constant of the dial (≈ the old 200 ms CSS transition). */
const TAU_MS = 90;

/** Arabic compass cardinals: شمال/شرق/جنوب/غرب at 0/90/180/270. */
const CARDINALS: Array<{ angle: number; letter: string }> = [
  { angle: 0, letter: "ش" },
  { angle: 90, letter: "ق" },
  { angle: 180, letter: "ج" },
  { angle: 270, letter: "غ" },
];

const TICKS = Array.from({ length: 24 }, (_, i) => i * 15);

function accuracyTone(acc: CompassAccuracy): string {
  if (acc === "high") return "border-safe/40 text-safe";
  if (acc === "medium") return "border-warning/40 text-warning";
  return "border-critical/40 text-critical";
}

export function QiblaCompass({ location, compass }: QiblaCompassProps) {
  const { t } = useI18n();
  const { status, accuracy, tiltHint, source, nativeSensor, needsGesture, start, subscribe } =
    compass;

  // Heading diagnostic (real-device debugging): always on in DEV; on a device,
  // 5 quick taps on the card title toggle it. Separates sensor error from
  // presentation (compare hdg against a known-good compass app) and exposes
  // whether the dial silently fell to static mode (source shows the status).
  const [diag, setDiag] = useState<boolean>(import.meta.env.DEV);
  const tapsRef = useRef({ n: 0, t: 0 });
  const onTitleTap = () => {
    const now = performance.now();
    const prev = tapsRef.current;
    const n = now - prev.t < 1500 ? prev.n + 1 : 1;
    tapsRef.current = { n, t: now };
    if (n >= 5) {
      tapsRef.current = { n: 0, t: 0 };
      setDiag((d) => !d);
    }
  };

  const bearing = bearingToKaaba(location.lat, location.lon);
  const distanceKm = distanceToKaabaKm(location.lat, location.lon);
  const live = status === "active";

  // ── Heading animation, deliberately OUTSIDE React ──────────────────────────
  // The sensor pushes ~20 Hz. Re-rendering this subtree per sample (and
  // restarting a 200 ms CSS transition on ~30 nodes every 50 ms) is what made
  // the tab feel laggy. Instead: one rAF loop eases a continuous angle toward
  // the latest sample and writes transforms straight to the DOM. Only `aligned`
  // — a boolean that changes seconds apart — still goes through state.
  const roseRef = useRef<HTMLDivElement>(null);
  const diagRef = useRef<HTMLSpanElement>(null);
  const [aligned, setAligned] = useState(false);

  useEffect(() => {
    const rose = roseRef.current;
    if (!rose) return;
    // Counter-rotated glyphs (cardinals + the Kaaba badge) carry their fixed
    // offset in data-counter, so the loop needs no per-element refs.
    const counters = Array.from(
      rose.querySelectorAll<HTMLElement>("[data-counter]"),
    ).map((el) => ({ el, offset: Number(el.dataset.counter) || 0 }));

    if (!live) {
      rose.style.transform = "rotate(0deg)";
      for (const { el, offset } of counters) el.style.transform = `rotate(${-offset}deg)`;
      setAligned(false);
      return;
    }

    let target = compass.getHeading() ?? 0;
    let displayed = target;
    let lastFrame = performance.now();
    let raf = 0;
    let alignedNow = false;
    let lastDiag = 0;

    const unsubscribe = subscribe((deg) => {
      target = deg;
    });

    const frame = (now: number) => {
      const k = smoothingFactor(now - lastFrame, TAU_MS);
      lastFrame = now;
      displayed = stepAngle(displayed, target, k);

      rose.style.transform = `rotate(${-displayed}deg)`;
      for (const { el, offset } of counters) {
        el.style.transform = `rotate(${displayed - offset}deg)`;
      }

      const next = Math.abs(shortestDelta(target, bearing)) <= ALIGN_DEG;
      if (next !== alignedNow) {
        alignedNow = next;
        setAligned(next);
      }

      if (diagRef.current && now - lastDiag > 250) {
        lastDiag = now;
        diagRef.current.textContent = String(Math.round(((target % 360) + 360) % 360));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [live, bearing, subscribe, compass]);

  // One subtle haptic per alignment entry (native plugin / web vibration).
  const wasAlignedRef = useRef(false);
  useEffect(() => {
    if (aligned && !wasAlignedRef.current) {
      if (isNative()) {
        void Compass.pulse().catch(() => undefined);
      } else if ("vibrate" in navigator) {
        try {
          navigator.vibrate(30);
        } catch {
          // unsupported — visual lock-on is enough
        }
      }
    }
    wasAlignedRef.current = aligned;
  }, [aligned]);

  const showCalibrate = live && (accuracy === "low" || accuracy === "unreliable");
  // Also while starting: a web compass started with the phone upright gets no
  // heading until it is lowered, so the hint is what tells the user to.
  const showHoldFlat = (live || status === "starting") && !showCalibrate && tiltHint;
  const staticMode = status === "unavailable" || status === "denied";

  const needleColor = aligned ? "var(--color-gold)" : "var(--color-teal)";

  return (
    <section className="card flex flex-col items-center gap-3 p-4">
      <div className="flex w-full items-center justify-between">
        <h2
          className="flex items-center gap-1.5 text-[13px] font-bold text-ink-dim"
          onClick={onTitleTap}
        >
          <CompassIcon className="size-4 text-teal" />
          {t("qibla.title")}
        </h2>
        {live && accuracy && (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              accuracyTone(accuracy),
            )}
          >
            {t(`qibla.acc.${accuracy}`)}
          </span>
        )}
      </div>

      {/* Compass face */}
      <div className="relative my-1 size-60">
        {/* Fixed top index marker — your facing direction (the phone's top). */}
        <div
          className={cn(
            "absolute left-1/2 top-[-2px] z-20 size-0 -translate-x-1/2",
            "border-x-[7px] border-t-[11px] border-x-transparent",
            aligned ? "border-t-gold" : "border-t-ink-faint",
          )}
          style={{ borderBottomWidth: 0 }}
        />

        {/* Outer dial ring (fixed) */}
        <div
          className={cn(
            "absolute inset-0 rounded-full border transition-colors",
            aligned
              ? "border-gold/60 shadow-[0_0_22px_-6px_var(--color-gold)]"
              : "border-ink-faint/25",
          )}
        />

        {/* Rotating rose: ticks + upright cardinals + the qibla needle. Its
            transform (and every [data-counter] glyph's) is written by the rAF
            loop above — no CSS transition, which is what used to be restarted
            every 50 ms. Identity rotation in static/idle mode. */}
        <div ref={roseRef} className="absolute inset-0" style={{ transform: "rotate(0deg)" }}>
          {TICKS.map((a) => (
            <div key={a} className="absolute inset-0" style={{ transform: `rotate(${a}deg)` }}>
              <div
                className={cn(
                  "absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full",
                  a % 90 === 0
                    ? "h-3 w-0.5 bg-ink-faint"
                    : a % 45 === 0
                      ? "h-2 w-0.5 bg-ink-faint/70"
                      : "h-1.5 w-px bg-ink-faint/40",
                )}
              />
            </div>
          ))}

          {/* Cardinal letters — positioned at their angle but each glyph is
              counter-rotated so it always reads upright (never tilted). */}
          {CARDINALS.map(({ angle, letter }) => (
            <div
              key={letter}
              className="absolute inset-0"
              style={{ transform: `rotate(${angle}deg)` }}
            >
              {/* Counter-rotated in the SAME frame as the rose, so the two
                  rotations cancel exactly and the glyph always reads upright
                  (data-counter = the glyph's own fixed angle on the dial). */}
              <span
                data-counter={angle}
                className={cn(
                  "absolute left-1/2 top-5 -translate-x-1/2 text-[13px] font-extrabold leading-none",
                  angle === 0 ? "text-critical" : "text-ink-dim",
                )}
                style={{ transform: `rotate(${-angle}deg)` }}
              >
                {letter}
              </span>
            </div>
          ))}

          {/* Qibla needle — a clean arrow from centre to the rim at the true
              bearing, with the Kaaba glyph (kept upright) at its tip. */}
          <div className="absolute inset-0" style={{ transform: `rotate(${bearing}deg)` }}>
            <div className="absolute bottom-1/2 left-1/2 top-4 flex w-8 -translate-x-1/2 flex-col items-center">
              {/* Kept upright via the same synced counter-rotation as the cardinals. */}
              <div
                data-counter={bearing}
                className="mb-0.5 grid size-6 place-items-center rounded-md"
                style={{
                  transform: `rotate(${-bearing}deg)`,
                  color: needleColor,
                  background: aligned ? "color-mix(in srgb, var(--color-gold) 18%, transparent)" : "transparent",
                }}
              >
                <MosqueIcon className="size-4" />
              </div>
              <svg
                viewBox="0 0 28 100"
                className="w-6 flex-1"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <polygon
                  points="14,0 25,30 18,30 18,100 10,100 10,30 3,30"
                  fill={needleColor}
                />
              </svg>
            </div>
          </div>
        </div>

        {/* Centre hub */}
        <div
          className={cn(
            "absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-colors",
            aligned ? "border-gold bg-gold/30" : "border-ink-faint/40 bg-surface",
          )}
        />
      </div>

      {/* Alignment / distance caption */}
      {aligned ? (
        <p className="text-[13px] font-bold text-gold">{t("qibla.aligned")}</p>
      ) : (
        <p className="tnum text-[12px] text-ink-dim">
          {t("qibla.distance")}: {Math.round(distanceKm).toLocaleString("en-US")} كم
        </p>
      )}
      {/* Lock-on announcement for screen readers (silent otherwise) */}
      <span className="sr-only" role="status">
        {aligned ? t("qibla.aligned") : ""}
      </span>

      {status === "starting" && (
        <p className="flex items-center gap-2 text-[12px] text-ink-faint">
          <Loader2 className="size-4 animate-spin" />
          {t("qibla.starting")}
        </p>
      )}
      {/* iOS-web only: motion permission needs a tap. Everywhere else auto-starts. */}
      {status === "idle" && needsGesture && (
        <button
          type="button"
          onClick={() => void start()}
          className="press hit-target flex items-center justify-center gap-2 rounded-xl border border-teal/30 bg-teal/[0.07] px-4 py-2.5 text-sm font-semibold text-teal transition-colors hover:bg-teal/[0.12]"
        >
          <CompassIcon className="size-4" />
          {t("qibla.start")}
        </button>
      )}
      {showCalibrate && (
        <p className="text-center text-[12px] text-warning">{t("qibla.calibrate")}</p>
      )}
      {showHoldFlat && (
        <p className="text-center text-[12px] text-ink-faint">{t("qibla.holdFlat")}</p>
      )}
      {staticMode && (
        <p className="text-center text-[12px] leading-5 text-ink-dim">
          {status === "denied" ? t("qibla.permission") : t("qibla.unavailable")}
          <br />
          {t("qibla.static")}
        </p>
      )}

      {/* Heading diagnostic — hidden by default; DEV always, device via 5 title
          taps (see onTitleTap). Compare hdg against a known-good compass app to
          distinguish sensor error from presentation; `source` doubles as the
          static-mode tell (shows the bare status when no sensor stream runs). */}
      {diag && (
        <p className="tnum text-[10px] text-ink-faint/70" dir="ltr">
          hdg <span ref={diagRef}>–</span>° · qibla {Math.round(bearing)}° ·{" "}
          {source ?? status}
          {nativeSensor ? `/${nativeSensor}` : ""} · {accuracy ?? "—"}
        </p>
      )}
    </section>
  );
}
