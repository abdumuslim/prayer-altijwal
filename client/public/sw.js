// Service worker — prayer reminders (web push) + click-to-focus.
// Adapted from the home project; the sensor branch is removed. The push payload
// is JSON: { title, body, prayer, lead, lang, kind, ... }.
//
// kind === "alarm": a full-screen phone-style alarm. If a focused visible app
// window exists we postMessage it (the page shows the AlarmOverlay + plays the
// tone) and SKIP the OS notification — Chrome only forgives a missing
// notification under userVisibleOnly when a focused client is handling it.
// Otherwise we show a persistent (requireInteraction) notification whose click
// opens the app straight into the alarm. kind === "notification" (or absent):
// the original quiet notification, unchanged.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const tag = data.prayer ? `prayer-${data.prayer}` : "prayer";

  if (data.kind === "alarm") {
    event.waitUntil(
      (async () => {
        const list = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        const firedAt = Date.now();
        const msg = { type: "prayer-alarm", payload: { ...data, firedAt } };
        for (const client of list) client.postMessage(msg);

        const focused = list.some(
          (c) => c.visibilityState === "visible" && c.focused,
        );
        if (focused) return; // the visible page handles it — no notification

        await self.registration.showNotification(data.title || "أوقات الصلاة", {
          body: data.body || "",
          icon: "/icons/icon-192.png",
          badge: "/icons/badge.png",
          tag,
          lang: data.lang || "ar",
          dir: data.lang === "en" ? "ltr" : "rtl",
          renotify: true,
          requireInteraction: true,
          vibrate: [500, 200, 500, 200, 500, 200, 500],
          data: { kind: "alarm", prayer: data.prayer, firedAt },
        });
      })(),
    );
    return;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "أوقات الصلاة", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge.png",
      tag,
      lang: data.lang || "ar",
      dir: data.lang === "en" ? "ltr" : "rtl",
      renotify: true,
      vibrate: [120, 60, 120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  // Alarm notifications open the app INTO the alarm: focus a live client and
  // postMessage it, or cold-open with ?alarm=<prayer>&t=<firedAt> so useAlarm
  // can raise the overlay on load.
  if (data.kind === "alarm") {
    event.waitUntil(
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clientList) => {
          const msg = { type: "prayer-alarm", payload: data };
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && "focus" in client) {
              client.postMessage(msg);
              return client.focus();
            }
          }
          const q = `?alarm=${encodeURIComponent(data.prayer || "")}&t=${data.firedAt || Date.now()}`;
          return self.clients.openWindow(`/${q}`);
        }),
    );
    return;
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow("/");
      }),
  );
});
