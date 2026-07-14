// Compass heading with the QIBLA_MASJID_SPEC §5 accuracy chain:
//   1. native  — CompassPlugin (fused ROTATION_VECTOR + GeomagneticField declination)
//   2. web     — deviceorientationabsolute, tilt-compensated (W3C rotation matrix)
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
  /** Smoothed heading in degrees CW from TRUE north; null until the first sample. */
  trueHeading: number | null;
  accuracy: CompassAccuracy | null;
  source: CompassSource | null;
  /** Raw device tilt for the level-bubble hint (web paths only). */
  tilt: { beta: number; gamma: number } | null;
  start: () => Promise<void>;
  stop: () => void;
}

/** EMA weight per sample (~150–250 ms window at sensor rates). */
const SMOOTH = 0.25;
/** Minimum ms between React state emissions (~20 Hz). */
const EMIT_MS = 50;
/** No absolute event within this window ⇒ the sensor doesn't exist (desktop). */
const PROBE_TIMEOUT_MS = 3000;

/**
 * Tilt-compensated compass heading from deviceorientation Euler angles — the
 * standard W3C-example rotation-matrix derivation (NOT raw `360 − alpha`).
 * Returns degrees CW from magnetic north in the device's own frame.
 */
function compassHeadingFromEuler(alpha: number, beta: number, gamma: number): number {
  const rad = Math.PI / 180;
  const _x = beta * rad;
  const _y = gamma * rad;
  const _z = alpha * rad;
  const cY = Math.cos(_y);
  const cZ = Math.cos(_z);
  const sX = Math.sin(_x);
  const sY = Math.sin(_y);
  const sZ = Math.sin(_z);

  const Vx = -cZ * sY - sZ * sX * cY;
  const Vy = -sZ * sY + cZ * sX * cY;

  let heading = Math.atan(Vx / Vy);
  if (Vy < 0) heading += Math.PI;
  else if (Vx < 0) heading += 2 * Math.PI;
  return heading / rad;
}

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
  const [trueHeading, setTrueHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<CompassAccuracy | null>(null);
  const [source, setSource] = useState<CompassSource | null>(null);
  const [tilt, setTilt] = useState<{ beta: number; gamma: number } | null>(null);

  const locationRef = useRef(location);
  locationRef.current = location;

  // Circular-EMA state + emit throttle + declination, all outside React state.
  const sinRef = useRef(0);
  const cosRef = useRef(0);
  const hasSampleRef = useRef(false);
  const lastEmitRef = useRef(0);
  const declRef = useRef(0);
  const cleanupsRef = useRef<Array<() => void>>([]);
  const runningRef = useRef(false);

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
    setTrueHeading(smoothed);
    setStatus((s) => (s === "starting" ? "active" : s));
  }, []);

  const stop = useCallback(() => {
    for (const fn of cleanupsRef.current) fn();
    cleanupsRef.current = [];
    runningRef.current = false;
    hasSampleRef.current = false;
    setStatus("idle");
    setTrueHeading(null);
    setAccuracy(null);
    setSource(null);
    setTilt(null);
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
        const magnetic =
          (compassHeadingFromEuler(e.alpha, e.beta, e.gamma) + screenAngle()) % 360;
        setTilt({ beta: e.beta, gamma: e.gamma });
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
        if (e.beta != null && e.gamma != null) setTilt({ beta: e.beta, gamma: e.gamma });
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
        if (!hasSampleRef.current) {
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
  }, [pushHeading]);

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

  return { status, trueHeading, accuracy, source, tilt, start, stop };
}
