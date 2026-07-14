// Qibla compass card (docs/QIBLA_MASJID_SPEC.md §5e). Live mode rotates the
// rose from the accuracy-chain heading (hooks/useCompassHeading) — never from
// relative sensors; without an absolute source it degrades to STATIC guidance
// (fixed rose, arrow at the true bearing, "point north then follow the arrow").
// Styled through semantic tokens/surface classes only (all 4 themes).

import { useEffect, useRef } from "react";
import { Compass as CompassIcon, Loader2 } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { CompassAccuracy, UseCompassHeading } from "@/hooks/useCompassHeading";
import { bearingToKaaba, distanceToKaabaKm } from "@/lib/qibla";
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
/** Tilt beyond this (either axis) shows the hold-flat hint (web paths only). */
const TILT_HINT_DEG = 30;

/** Arabic compass cardinals: شمال/شرق/جنوب/غرب. */
const CARDINALS: Array<{ angle: number; letter: string }> = [
  { angle: 0, letter: "ش" },
  { angle: 90, letter: "ق" },
  { angle: 180, letter: "ج" },
  { angle: 270, letter: "غ" },
];

const TICKS = Array.from({ length: 12 }, (_, i) => i * 30);

function accuracyTone(acc: CompassAccuracy): string {
  if (acc === "high") return "border-safe/40 text-safe";
  if (acc === "medium") return "border-warning/40 text-warning";
  return "border-critical/40 text-critical";
}

export function QiblaCompass({ location, compass }: QiblaCompassProps) {
  const { t } = useI18n();
  const { status, trueHeading, accuracy, tilt, start } = compass;

  const bearing = bearingToKaaba(location.lat, location.lon);
  const distanceKm = distanceToKaabaKm(location.lat, location.lon);
  const live = status === "active" && trueHeading != null;

  // Unwrap the heading so CSS transitions never spin the long way at 359→0.
  const contRef = useRef(0);
  const lastRef = useRef<number | null>(null);
  if (live && trueHeading != null) {
    const prev = lastRef.current;
    if (prev == null) {
      contRef.current = trueHeading;
    } else {
      let delta = trueHeading - prev;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      contRef.current += delta;
    }
    lastRef.current = trueHeading;
  } else if (lastRef.current != null) {
    contRef.current = 0;
    lastRef.current = null;
  }
  const rot = live ? contRef.current : 0;

  // Relative qibla angle (shortest signed distance heading→bearing).
  const delta = live ? ((bearing - (trueHeading as number) + 540) % 360) - 180 : null;
  const aligned = delta != null && Math.abs(delta) <= ALIGN_DEG;

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
  const showHoldFlat =
    live &&
    !showCalibrate &&
    tilt != null &&
    (Math.abs(tilt.beta) > TILT_HINT_DEG || Math.abs(tilt.gamma) > TILT_HINT_DEG);
  const staticMode = status === "unavailable" || status === "denied";
  const rotTransition =
    "transition-transform duration-150 ease-linear motion-reduce:transition-none";

  return (
    <section className="card flex flex-col items-center gap-3 p-4">
      <div className="flex w-full items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-[13px] font-bold text-ink-dim">
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
      <div className="relative size-52">
        {/* Fixed phone-up marker */}
        <div
          className={cn(
            "absolute left-1/2 top-[-3px] z-10 size-0 -translate-x-1/2",
            "border-x-[6px] border-t-[9px] border-x-transparent",
            aligned ? "border-t-gold" : "border-t-ink-faint",
          )}
          style={{ borderBottomWidth: 0 }}
        />

        {/* Rotating rose (identity rotation in static/idle mode). No own fill —
            it inherits the card surface so ink tokens stay readable per theme. */}
        <div
          className={cn(
            "absolute inset-0 rounded-full border",
            rotTransition,
            aligned
              ? "border-gold/60 shadow-[0_0_16px_-4px_var(--color-gold)]"
              : "border-ink-faint/30",
          )}
          style={{ transform: `rotate(${-rot}deg)` }}
        >
          {TICKS.map((a) => (
            <div key={a} className="absolute inset-0" style={{ transform: `rotate(${a}deg)` }}>
              <div
                className={cn(
                  "absolute left-1/2 top-1.5 -translate-x-1/2 rounded-full",
                  a % 90 === 0 ? "h-2.5 w-0.5 bg-ink-faint" : "h-1.5 w-px bg-ink-faint/50",
                )}
              />
            </div>
          ))}
          {CARDINALS.map(({ angle, letter }) => (
            <div
              key={letter}
              className="absolute inset-0"
              style={{ transform: `rotate(${angle}deg)` }}
            >
              <span
                className={cn(
                  "absolute left-1/2 top-4 -translate-x-1/2 text-[11px] font-bold",
                  angle === 0 ? "text-critical" : "text-ink-faint",
                )}
              >
                {letter}
              </span>
            </div>
          ))}

          {/* Kaaba marker at the true bearing (inside the rose so it tracks north) */}
          <div className="absolute inset-0" style={{ transform: `rotate(${bearing}deg)` }}>
            <div className="absolute left-1/2 top-6 -translate-x-1/2">
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border",
                  rotTransition,
                  aligned
                    ? "border-gold bg-gold/20 text-gold"
                    : "border-teal/40 bg-teal/10 text-teal",
                )}
                style={{ transform: `rotate(${rot - bearing}deg)` }}
              >
                <MosqueIcon className="size-5" />
              </div>
            </div>
          </div>
        </div>

        {/* Fixed center readout */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-medium text-ink-faint">{t("qibla.bearing")}</span>
          <span className="tnum text-2xl font-bold text-ink">{Math.round(bearing)}°</span>
          {aligned && (
            <span className="text-[11px] font-bold text-gold">{t("qibla.aligned")}</span>
          )}
        </div>
      </div>

      {/* Lock-on announcement for screen readers (silent otherwise) */}
      <span className="sr-only" role="status">
        {aligned ? t("qibla.aligned") : ""}
      </span>

      <p className="tnum text-[12px] text-ink-dim">
        {t("qibla.distance")}: {Math.round(distanceKm).toLocaleString("en-US")} كم
      </p>

      {status === "idle" && (
        <button
          type="button"
          onClick={() => void start()}
          className="hit-target flex items-center justify-center gap-2 rounded-xl border border-teal/30 bg-teal/[0.07] px-4 py-2.5 text-sm font-semibold text-teal transition-colors hover:bg-teal/[0.12]"
        >
          <CompassIcon className="size-4" />
          {t("qibla.start")}
        </button>
      )}
      {status === "starting" && (
        <p className="flex items-center gap-2 text-[12px] text-ink-faint">
          <Loader2 className="size-4 animate-spin" />
          {t("qibla.starting")}
        </p>
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
    </section>
  );
}
