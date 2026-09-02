// Service Worker GLORI-YAH Admin — minimal, juste pour rendre le PWA installable.
// Pas de mode hors-ligne pour l'admin (les données de supervision doivent
// toujours être fraîches, jamais servies depuis un cache).

const CACHE_NAME = 'glori-yah-admin-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Toujours réseau — jamais de cache pour l'admin.
  event.respondWith(fetch(event.request));
});
