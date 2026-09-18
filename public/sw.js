// Web Push service worker. Registered from components/PushNotificationToggle.tsx.
// Deliberately does nothing for fetch/install/activate beyond the defaults —
// this app has no offline-caching story, the service worker exists purely
// to receive push events while the app isn't open in a foreground tab.

self.addEventListener("push", (event) => {
  let data = { title: "Alaia Homes Dev", body: "You have a new update." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload (shouldn't happen — lib/webPush.ts always sends
    // JSON.stringify'd payloads) — fall back to the default text above.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: data.url || "/projects" },
    })
  );
});

// Focuses an already-open tab on the target URL if one exists, otherwise
// opens a new one — the standard pattern for "clicking a push notification
// should feel like switching to the app, not always launching a new window."
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/projects";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if (client.url === targetUrl && "focus" in client) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
