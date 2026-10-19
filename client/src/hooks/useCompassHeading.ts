// Compass heading with the QIBLA_MASJID_SPEC §5 accuracy chain:
//   1. native  — CompassPlugin (fused ROTATION_VECTOR + GeomagneticField declination)
//   2. web     — deviceorientationabsolute, heading of the screen's top edge
//                (lib/compass-heading.ts; exact for any roll and screen rotation)
//   3. web iOS — webkitCompassHeading after requestPermission() (must run inside
//                the start-button tap — it throws outside a user gesture)
//   4. neither — status "unavailable" → the UI renders static guidance; a needle
//                is NEVER animated from non-absolute data.
// Web paths add server-computed WMM declination (lib/declination.ts, cached).
// Headings are smoothed on the unit circle (sin/cos EMA) and emitted ≤ 20 Hz.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import { Compass, isNative, type CompassHeadingEvent } from "@/lib/native";
import { getDeclination } from "@/lib/declination";
import { headingFromEuler } from "@/lib/compass-heading";

export type CompassStatus = "idle" | "starting" | "active" | "unavailable" | "denied";
export type CompassAccuracy = "high" | "medium" | "low" | "unreliable";
export type CompassSource = "native" | "web-absolute" | "web-ios";

export interface CompassLocation {
  lat: number;
  lon: number;
  elevation: number | null;
}

export interface UseCompassHeading {
  status: CompassStatus;
  accuracy: CompassAccuracy | null;
  source: CompassSource | null;
  /** Which native sensor path the device landed on (CompassPlugin `source`) —
   *  "rotation-vector" | "geomagnetic-rv" | "accel-mag". Diagnostic only. */
  nativeSensor: string | null;
  /**
   * Subscribe to the smoothed heading (degrees CW from TRUE north, ≤ 20 Hz).
   *
   * Heading is deliberately NOT React state: at 20 Hz it re-rendered the whole
   * Times tab and made the app feel laggy on mid-range phones. Consumers drive
   * transforms imperatively from one rAF loop instead (lib/heading-anim.ts).
   */
  subscribe: (listener: (deg: number) => void) => () => void;
  /** Latest smoothed heading, or null before the first sample. */
  getHeading: () => number | null;
  /** Device held too steeply for a trustworthy reading (web paths only).
   *  Hysteretic, so it can't flicker at the threshold. */
  tiltHint: boolean;
  /** True only for the iOS-web path, whose requestPermission() MUST run inside a
   *  user gesture. When false (native + Android-web-absolute + desktop) the
   *  compass may auto-start with no button and never prompts. */
  needsGesture: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

/** iOS Safari/PWA is the only path that requires a start-button tap (its
 *  DeviceOrientationEvent.requestPermission throws outside a user gesture). */
function computeNeedsGesture(): boolean {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
    return false;
  }
  const doe = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  return (
    !isNative() &&
    !("ondeviceorientationabsolute" in window) &&
    typeof doe.requestPermission === "function"
  );
}

/** EMA weight per sample (~150–250 ms window at sensor rates). */
const SMOOTH = 0.25;
/** Minimum ms between emissions to subscribers (~20 Hz). */
const EMIT_MS = 50;
/** No absolute event within this window ⇒ the sensor doesn't exist (desktop). */
const PROBE_TIMEOUT_MS = 3000;
/** Tilt beyond this (either axis) raises the hold-flat hint… */
const TILT_ENTER_DEG = 30;
/** …and it only clears below this, so a hand hovering at 30° can't strobe it. */
const TILT_EXIT_DEG = 25;

function screenAngle(): number {
  try {
    return window.screen.orientation?.angle ?? 0;
  } catch {
    return 0;
  }
}

interface IosOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

/** webkitCompassAccuracy is the max deviation in degrees; negative = unreliable. */
function iosAccuracy(dev: number | undefined): CompassAccuracy {
  if (typeof dev !== "number" || dev < 0) return "unreliable";
  if (dev <= 10) return "high";
  if (dev <= 25) return "medium";
  return "low";
}

export function useCompassHeading(location: CompassLocation | null): UseCompassHeading {
  const [status, setStatus] = useState<CompassStatus>("idle");
  const [accuracy, setAccuracy] = useState<CompassAccuracy | null>(null);
  const [source, setSource] = useState<CompassSource | null>(null);
  const [nativeSensor, setNativeSensor] = useState<string | null>(null);
  const [tiltHint, setTiltHint] = useState(false);

  const locationRef = useRef(location);
  locationRef.current = location;

  // Circular-EMA state + emit throttle + declination, all outside React state.
  const sinRef = useRef(0);
  const cosRef = useRef(0);
  const hasSampleRef = useRef(false);
  /** An absolute event arrived, even one too steep to give a heading — the
   *  sensor exists, so the probe must not declare it unavailable. */
  const sensorSeenRef = useRef(false);
  const headingRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);
  const declRef = useRef(0);
  const cleanupsRef = useRef<Array<() => void>>([]);
  const runningRef = useRef(false);
  const listenersRef = useRef(new Set<(deg: number) => void>());

  const subscribe = useCallback((listener: (deg: number) => void) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    // Late subscribers (component mounted after the sensor started) get the
    // current heading immediately instead of a frozen dial until the next event.
    if (headingRef.current != null) listener(headingRef.current);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const getHeading = useCallback(() => headingRef.current, []);

  /** Hysteretic tilt gate — React state changes at most on a real crossing. */
  const pushTilt = useCallback((beta: number, gamma: number) => {
    const worst = Math.max(Math.abs(beta), Math.abs(gamma));
    setTiltHint((on) => (on ? worst > TILT_EXIT_DEG : worst > TILT_ENTER_DEG));
  }, []);

  const pushHeading = useCallback((deg: number) => {
    const rad = (deg * Math.PI) / 180;
    if (!hasSampleRef.current) {
      sinRef.current = Math.sin(rad);
      cosRef.current = Math.cos(rad);
      hasSampleRef.current = true;
    } else {
      sinRef.current += SMOOTH * (Math.sin(rad) - sinRef.current);
      cosRef.current += SMOOTH * (Math.cos(rad) - cosRef.current);
    }
    const now = performance.now();
    if (now - lastEmitRef.current < EMIT_MS) return;
    lastEmitRef.current = now;
    const smoothed =
      ((Math.atan2(sinRef.current, cosRef.current) * 180) / Math.PI + 360) % 360;
    headingRef.current = smoothed;
    for (const listener of listenersRef.current) listener(smoothed);
    setStatus((s) => (s === "starting" ? "active" : s));
  }, []);

  const stop = useCallback(() => {
    for (const fn of cleanupsRef.current) fn();
    cleanupsRef.current = [];
    runningRef.current = false;
    hasSampleRef.current = false;
    sensorSeenRef.current = false;
    headingRef.current = null;
    setStatus("idle");
    setAccuracy(null);
    setSource(null);
    setNativeSensor(null);
    setTiltHint(false);
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    const loc = locationRef.current;
    if (!loc) return;
    runningRef.current = true;
    setStatus("starting");

    // ── iOS permission MUST be the first await (still inside the tap gesture) ──
    const doe = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    const hasAbsolute = "ondeviceorientationabsolute" in window;
    const needsIosPermission = !isNative() && !hasAbsolute && typeof doe.requestPermission === "function";
    if (needsIosPermission) {
      let perm = "denied";
      try {
        perm = await doe.requestPermission!();
      } catch {
        // thrown outside a user gesture or blocked — treat as denied
      }
      if (perm !== "granted") {
        runningRef.current = false;
        setStatus("denied");
        return;
      }
    }

    // ── 1. Native fused sensor ──
    if (isNative()) {
      try {
        const handle: PluginListenerHandle = await Compass.addListener(
          "heading",
          (e: CompassHeadingEvent) => {
            setAccuracy(e.accuracy);
            if (e.source) setNativeSensor((s) => (s === e.source ? s : e.source ?? null));
            pushHeading(e.trueHeading);
          },
        );
        await Compass.start({ lat: loc.lat, lon: loc.lon, alt: loc.elevation ?? 0 });
        cleanupsRef.current.push(() => {
          void handle.remove();
          void Compass.stop().catch(() => undefined);
        });
        setSource("native");
        return;
      } catch {
        // Plugin unavailable (e.g. web dev build inside a WebView) — fall through.
      }
    }

    // ── Web paths need declination (magnetic → true). Null ⇒ proceed magnetic. ──
    declRef.current = (await getDeclination(loc.lat, loc.lon)) ?? 0;
    if (!runningRef.current) return; // stopped while fetching

    // ── 2. Android Chrome absolute orientation ──
    if (hasAbsolute) {
      const onEvent = (e: DeviceOrientationEvent) => {
        if (e.alpha == null || e.beta == null || e.gamma == null) return;
        if (e.absolute !== true) return;
        sensorSeenRef.current = true;
        pushTilt(e.beta, e.gamma);
        const magnetic = headingFromEuler(e.alpha, e.beta, e.gamma, screenAngle());
        // Screen's top near vertical: no defined heading. Keep the last one;
        // the hold-flat hint is already up at this tilt.
        if (magnetic == null) return;
        pushHeading((magnetic + declRef.current + 360) % 360);
      };
      window.addEventListener("deviceorientationabsolute", onEvent as EventListener);
      cleanupsRef.current.push(() =>
        window.removeEventListener("deviceorientationabsolute", onEvent as EventListener),
      );
      // This path has no calibration signal — a fixed mid confidence is honest.
      setAccuracy("medium");
      setSource("web-absolute");
      armProbeTimeout();
      return;
    }

    // ── 3. iOS Safari/PWA webkitCompassHeading (permission already granted) ──
    if (needsIosPermission) {
      const onEvent = (e: IosOrientationEvent) => {
        if (typeof e.webkitCompassHeading !== "number") return;
        if (e.beta != null && e.gamma != null) pushTilt(e.beta, e.gamma);
        setAccuracy(iosAccuracy(e.webkitCompassAccuracy));
        const magnetic = (e.webkitCompassHeading + screenAngle()) % 360;
        pushHeading((magnetic + declRef.current + 360) % 360);
      };
      window.addEventListener("deviceorientation", onEvent as EventListener);
      cleanupsRef.current.push(() =>
        window.removeEventListener("deviceorientation", onEvent as EventListener),
      );
      setSource("web-ios");
      armProbeTimeout();
      return;
    }

    // ── 4. No absolute source (desktop / denied APIs) → static guidance ──
    runningRef.current = false;
    setStatus("unavailable");

    function armProbeTimeout(): void {
      const timer = window.setTimeout(() => {
        if (!hasSampleRef.current && !sensorSeenRef.current) {
          // Listener exists but never fired with usable data (typical desktop).
          for (const fn of cleanupsRef.current) fn();
          cleanupsRef.current = [];
          runningRef.current = false;
          setStatus("unavailable");
          setSource(null);
          setAccuracy(null);
        }
      }, PROBE_TIMEOUT_MS);
      cleanupsRef.current.push(() => window.clearTimeout(timer));
    }
  }, [pushHeading, pushTilt]);

  // Battery: sensors must not run while the app/tab is hidden. The component
  // additionally stops when the Times tab loses `active` (keep-mounted tabs).
  useEffect(() => {
    if (status !== "active" && status !== "starting") return;
    const onHide = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [status, stop]);

  // Unmount safety net.
  useEffect(() => stop, [stop]);

  const needsGesture = computeNeedsGesture();

  return {
    status,
    accuracy,
    source,
    nativeSensor,
    subscribe,
    getHeading,
    tiltHint,
    needsGesture,
    start,
    stop,
  };
}
