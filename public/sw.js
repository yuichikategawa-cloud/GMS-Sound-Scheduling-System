/* GMS Sound Scheduling PWA service worker.
 * Caches only the static application shell and same-origin static assets.
 * Supabase/API responses and private servant/admin data are never cached.
 */
const CACHE_PREFIX = "gms-static-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const APP_SHELL = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/gms-sound-favicon.svg",
  "/icons/gms-icon-192.png",
  "/icons/apple-touch-icon.png",
  "/icons/gms-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
        }
        return response;
      } catch {
        return (await caches.match("/offline.html")) || new Response("You are offline. Reconnect and try again.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  // Cache same-origin build assets only. Never intercept external Supabase requests.
  const isStaticAsset = ["script", "style", "image", "font"].includes(request.destination)
    || url.pathname === "/manifest.webmanifest"
    || url.pathname === "/gms-sound-favicon.svg";
  if (!isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : "You have a new GMS update." }; }

  const title = payload.title || "GMS Sound Scheduling";
  const options = {
    body: payload.body || "You have a new serving update.",
    icon: "/icons/gms-icon-192.png",
    badge: "/icons/gms-icon-192.png",
    tag: payload.tag || "gms-notification",
    renotify: false,
    data: { url: payload.url || "/?tab=notifications" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "/?tab=notifications", self.location.origin);
    if (target.origin !== self.location.origin) target.href = new URL("/", self.location.origin).href;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(target.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
