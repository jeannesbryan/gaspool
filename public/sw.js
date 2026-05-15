const CACHE_NAME = 'gaspool-v1';
const urlsToCache = [
  '/',
  '/login',
  '/manifest.json'
];

// Saat aplikasi diinstal, simpan halaman penting ke dalam memori HP
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Strategi: "Coba ambil dari internet dulu, kalau sinyal hilang, ambil dari memori (Cache)"
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});