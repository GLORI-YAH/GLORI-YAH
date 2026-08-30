// Service de calcul d'itinéraire réel (Google Directions API).
//
// Pourquoi : services/pricing.js utilisait jusqu'ici une distance "à vol d'oiseau"
// (Haversine) corrigée par un facteur estimatif (x1.3), qui approxime grossièrement
// la vraie distance routière — suffisant pour démarrer, mais imprécis (le tracé
// affiché au passager était une ligne droite, pas les vraies rues empruntées).
//
// Ce service appelle Google Directions API pour obtenir :
//  - la distance réelle en suivant les routes
//  - la durée réelle estimée (tient compte du réseau routier, pas juste une vitesse moyenne)
//  - le tracé exact (polyline encodée) à afficher sur la carte Leaflet
//
// Résilience : si la clé API est absente, la requête échoue, ou Google renvoie un
// statut différent de OK (ex. ZERO_RESULTS, quota dépassé, réseau instable — un cas
// réel et fréquent signalé à Abomey-Calavi), on retombe automatiquement sur le calcul
// Haversine existant. Le service ne doit JAMAIS faire échouer une estimation de prix
// ou une demande de course à cause d'un souci réseau/API externe.

const { haversineKm, estimateDurationMin } = require('./pricing');

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';

/**
 * Calcule l'itinéraire réel entre deux points.
 * pickup / destination : { lat, lng }
 *
 * Retour : {
 *   distanceKm: number,
 *   durationMin: number,
 *   polyline: string|null,   // polyline encodée Google (décodable côté frontend), null si repli
 *   source: 'google' | 'fallback_haversine',
 * }
 */
async function getRoute(pickup, destination) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return fallback(pickup, destination);
  }

  try {
    const params = new URLSearchParams({
      origin: `${pickup.lat},${pickup.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'driving',
      key: apiKey,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s max — jamais bloquer une estimation de prix

    let response;
    try {
      response = await fetch(`${DIRECTIONS_URL}?${params.toString()}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn('Google Directions API — HTTP', response.status);
      return fallback(pickup, destination);
    }

    const data = await response.json();

    if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
      console.warn('Google Directions API — statut', data.status, data.error_message || '');
      return fallback(pickup, destination);
    }

    const leg = data.routes[0].legs[0];
    const distanceKm = leg.distance.value / 1000;
    const durationMin = leg.duration.value / 60;
    const polyline = data.routes[0].overview_polyline?.points || null;

    return { distanceKm, durationMin, polyline, source: 'google' };
  } catch (err) {
    console.warn('Google Directions API — erreur réseau, repli sur Haversine :', err.message);
    return fallback(pickup, destination);
  }
}

function fallback(pickup, destination) {
  const distanceKm = haversineKm(pickup.lat, pickup.lng, destination.lat, destination.lng);
  const durationMin = estimateDurationMin(distanceKm);
  return { distanceKm, durationMin, polyline: null, source: 'fallback_haversine' };
}

module.exports = { getRoute };
