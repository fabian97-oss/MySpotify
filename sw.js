const CACHE_NAME = "myspotify-v11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css?v=2.4.0",
  "./manifest.json?v=2.4.0",
  "./js/app.js?v=2.4.0",
  "./js/database.js?v=2.4.0",
  "./js/metadata.js?v=2.4.0",
  "./js/player.js?v=2.4.0",
  "./js/google-drive.js?v=2.4.0",
  "./assets/images/icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith("myspotify-") && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has("range")) return; // Audio-/Range-Anfragen nicht aus dem App-Cache bedienen.

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          await cache.put("./index.html", response.clone());
        }
        return response;
      } catch (error) {
        const offlinePage = await cache.match("./index.html");
        if (offlinePage) return offlinePage;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
