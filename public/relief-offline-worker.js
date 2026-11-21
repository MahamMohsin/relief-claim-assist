const offlineCache = "relief-public-offline-v1";
const offlinePage = "/relief-offline.html";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(offlineCache).then(cache => cache.add(offlinePage)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !["/", "/login"].includes(url.pathname)) return;
  event.respondWith(fetch(request).catch(async () => {
    const cached = await (await caches.open(offlineCache)).match(offlinePage);
    return cached ?? Response.error();
  }));
});
