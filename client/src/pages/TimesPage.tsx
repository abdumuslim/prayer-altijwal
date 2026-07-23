// Second tab — qibla compass + nearest masjids (docs/QIBLA_MASJID_SPEC.md §7).
// The monthly table was REMOVED here on 2026-07-23 (user): it rebuilt a whole
// month on every visit to this tab — on the phone that is the engine computing
// ~30 days offline plus ~30 rows rendered — for a feature nobody was using.
// The today prayer strip went earlier (duplicate of the Home strip — user,
// 2026-07-19); its per-prayer check-ins live on the Home strip instead. The
// compass heading hook lives HERE so the qibla card and the masjid bearing
// arrows share one sensor stream; sensors stop whenever the tab is hidden
// (keep-mounted tabs).

import { useCallback, useEffect, useRef, useState } from "react";
import { QiblaCompass } from "@/components/qibla/QiblaCompass";
import { NearestMasjids } from "@/components/masjid/NearestMasjids";
import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { hasGeolocationPermission } from "@/lib/geolocation";
import { useCompassHeading } from "@/hooks/useCompassHeading";
import type { useLocation } from "@/hooks/useLocation";
import type { usePrayerTimes } from "@/hooks/usePrayerTimes";

interface TimesPageProps {
  location: ReturnType<typeof useLocation>;
  times: ReturnType<typeof usePrayerTimes>;
  /** Tab visibility (pages are keep-mounted) — gates sensors + lazy loads. */
  active: boolean;
}

export function TimesPage({ location, times, active }: TimesPageProps) {
  const loc = location.location;
  const compass = useCompassHeading(
    loc ? { lat: loc.lat, lon: loc.lon, elevation: loc.elevation } : null,
  );
  const { stop: stopCompass, start: startCompass } = compass;

  // Keep-mounted tabs: sensors must not run while the user sits on another tab.
  useEffect(() => {
    if (!active) stopCompass();
  }, [active, stopCompass]);

  // Auto-start the compass whenever this tab is shown, EXCEPT on iOS-web where
  // the sensor permission needs an explicit button tap. Returning to the tab
  // re-fires (stop() reset status to "idle") → "starts by itself, never asks"
  // (docs/QIBLA_MASJID_SPEC.md — the user's one-time-permission request).
  useEffect(() => {
    if (active && loc && compass.status === "idle" && !compass.needsGesture) {
      void startCompass();
    }
  }, [active, loc, compass.status, compass.needsGesture, startCompass]);

  // Bumped by pull-to-refresh → NearestMasjids refetches.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { requestGpsStaged } = location;

  // A user who already granted location shouldn't have to press "use my
  // location" again on every visit — but permission is only CHECKED here, never
  // requested, so the opt-in stays opt-in for everyone else (spec Q5).
  const autoFixTriedRef = useRef(false);
  useEffect(() => {
    if (!active || autoFixTriedRef.current) return;
    if (loc?.source === "gps") return;
    autoFixTriedRef.current = true;
    void hasGeolocationPermission().then((granted) => {
      if (granted) void requestGpsStaged().catch(() => undefined);
    });
  }, [active, loc?.source, requestGpsStaged]);

  const onRefresh = useCallback(async () => {
    setRefreshNonce((n) => n + 1);
    await requestGpsStaged().catch(() => undefined);
  }, [requestGpsStaged]);

  if (!times.data) return null;

  return (
    <>
      <PullToRefresh onRefresh={onRefresh} enabled={active} />
      {loc && (
        <>
          <QiblaCompass location={loc} compass={compass} />
          <NearestMasjids
            location={loc}
            active={active}
            compass={compass}
            onUseGps={() => void requestGpsStaged().catch(() => undefined)}
            resolving={location.resolving}
            gpsErrorKind={location.errorKind}
            refreshNonce={refreshNonce}
          />
        </>
      )}
    </>
  );
}
