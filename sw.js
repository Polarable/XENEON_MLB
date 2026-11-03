// SHUTOUT service worker. It does not cache anything: the site updates itself through version.json,
// and a stale offline copy would fight that. Its jobs are making the app installable and showing push alerts.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "SHUTOUT", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "SHUTOUT", {
    body: d.body || "",
    icon: d.icon || "m/icon-192.png",
    badge: "m/icon-192.png",
    tag: d.tag,            // same tag replaces the older alert (a game's score updates in place)
    renotify: !!d.tag,
    data: { url: d.url || "m/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "m/", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = wins.find((w) => new URL(w.url).pathname.includes("/m/"));
    if (app) { await app.focus(); return app.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
