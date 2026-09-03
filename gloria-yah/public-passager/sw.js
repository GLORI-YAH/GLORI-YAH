// Service Worker GLORI-YAH — permet à l'espace pilote de continuer à fonctionner
// (afficher l'interface, mettre les actions en attente) même si le réseau coupe,
// comme observé à Abomey-Calavi où la 4G est instable.

const CACHE_NAME = 'glori-yah-v3';
const OFFLINE_QUEUE_DB = 'glori-yah-offline-queue';

// Fichiers essentiels mis en cache pour un fonctionnement hors-ligne minimal
// — couvre maintenant les deux côtés (pilote ET passager), pas seulement le pilote.
const PRECACHE_FILES = [
  '/index.html',
  '/inscription.html',
  '/assets/style.css?v=3',
  '/assets/api.js',
  '/assets/config.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_FILES))
  );
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

// Stratégie : réseau d'abord, cache en secours (pour que la page se charge même hors-ligne)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return; // les POST (actions) sont gérées séparément, voir offline-queue.js

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
