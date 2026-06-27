const CACHE_NAME = "gaspool-v1";

const urlsToCache = ["/", "/login", "/manifest.json", "/offline.html"];

// Saat aplikasi diinstal
self.addEventListener("install", (event) => {
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    }),
  );
});

// Saat service worker aktif
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              return caches.delete(key);
            }
          }),
        ),
      ),
      clients.claim(),
    ]),
  );
});

// Network First
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);

      return cached || caches.match("/offline.html");
    }),
  );
});
