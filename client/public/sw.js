// Service worker — prayer reminders (web push) + click-to-focus.
// Adapted from the home project; the sensor branch is removed. The push payload
// is JSON: { title, body, prayer, lead, lang, ... }.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const tag = data.prayer ? `prayer-${data.prayer}` : "prayer";

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
  event.notification.close();
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
