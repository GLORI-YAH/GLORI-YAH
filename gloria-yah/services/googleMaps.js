// Service de calcul d'itinéraire réel.
//
// Pourquoi : services/pricing.js utilisait jusqu'ici une distance "à vol d'oiseau"
// (Haversine) corrigée par un facteur estimatif (x1.3), qui approxime grossièrement
// la vraie distance routière — suffisant pour démarrer, mais imprécis (le tracé
// affiché au passager était une ligne droite, pas les vraies rues empruntées).
//
// Deux fournisseurs possibles, essayés dans l'ordre :
//  1. Google Directions API — le plus précis, mais demande une carte bancaire
//     valide chez Google Cloud (même pour l'usage gratuit).
//  2. OpenRouteService — gratuit, inscription par email uniquement, AUCUNE carte
//     bancaire requise (2000 requêtes/jour en gratuit). Choix par défaut pour
//     l'utilisateur qui n'a pas de carte bancaire valide.
//  3. Repli Haversine (déjà existant) si aucune clé n'est configurée, ou si les
//     deux services échouent (réseau instable, quota dépassé...).
//
// Résilience : jamais d'échec d'estimation de prix ou de demande de course à
// cause d'un souci réseau/API externe — on retombe toujours sur Haversine.

const { haversineKm, estimateDurationMin } = require('./pricing');

const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car';

/**
 * Calcule l'itinéraire réel entre deux points.
 * pickup / destination : { lat, lng }
 *
 * Retour : {
 *   distanceKm: number,
 *   durationMin: number,
 *   polyline: string|null,   // polyline encodée format Google (décodable côté frontend), null si repli
 *   source: 'google' | 'openrouteservice' | 'fallback_haversine',
 * }
 */
async function getRoute(pickup, destination) {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    const result = await tryGoogle(pickup, destination);
    if (result) return result;
  }

  if (process.env.OPENROUTESERVICE_API_KEY) {
    const result = await tryOpenRouteService(pickup, destination);
    if (result) return result;
  }

  return fallback(pickup, destination);
}

async function tryGoogle(pickup, destination) {
  try {
    const params = new URLSearchParams({
      origin: `${pickup.lat},${pickup.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: 'driving',
      key: process.env.GOOGLE_MAPS_API_KEY,
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
      return null;
    }

    const data = await response.json();
    if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
      console.warn('Google Directions API — statut', data.status, data.error_message || '');
      return null;
    }

    const leg = data.routes[0].legs[0];
    return {
      distanceKm: leg.distance.value / 1000,
      durationMin: leg.duration.value / 60,
      polyline: data.routes[0].overview_polyline?.points || null,
      source: 'google',
    };
  } catch (err) {
    console.warn('Google Directions API — erreur réseau :', err.message);
    return null;
  }
}

async function tryOpenRouteService(pickup, destination) {
  try {
    const params = new URLSearchParams({
      api_key: process.env.OPENROUTESERVICE_API_KEY,
      start: `${pickup.lng},${pickup.lat}`, // ORS attend lng,lat (norme GeoJSON), pas lat,lng
      end: `${destination.lng},${destination.lat}`,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response;
    try {
      response = await fetch(`${ORS_URL}?${params.toString()}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      console.warn('OpenRouteService — HTTP', response.status);
      return null;
    }

    const data = await response.json();
    const feature = data.features?.[0];
    const segment = feature?.properties?.segments?.[0];
    const coordinates = feature?.geometry?.coordinates; // [[lng, lat], ...]
    if (!segment || !coordinates) {
      console.warn('OpenRouteService — réponse inattendue', JSON.stringify(data).slice(0, 200));
      return null;
    }

    // ORS renvoie les coordonnées brutes (lng, lat) plutôt qu'une polyline encodée
    // — on les encode nous-mêmes au format Google pour que le décodeur déjà
    // construit côté frontend (Leaflet) fonctionne sans changement, quel que
    // soit le fournisseur utilisé.
    const points = coordinates.map(([lng, lat]) => [lat, lng]);

    return {
      distanceKm: segment.distance / 1000,
      durationMin: segment.duration / 60,
      polyline: encodePolyline(points),
      source: 'openrouteservice',
    };
  } catch (err) {
    console.warn('OpenRouteService — erreur réseau :', err.message);
    return null;
  }
}

function fallback(pickup, destination) {
  const distanceKm = haversineKm(pickup.lat, pickup.lng, destination.lat, destination.lng);
  const durationMin = estimateDurationMin(distanceKm);
  return { distanceKm, durationMin, polyline: null, source: 'fallback_haversine' };
}

// --- Encodeur de polyline format Google (algorithme standard, inverse du
// décodeur déjà présent côté frontend) — permet à n'importe quel fournisseur
// de routage de produire un tracé affichable sans dupliquer la logique de
// décodage sur chaque page (passager, pilote).
function encodePolyline(points) {
  let output = '';
  let prevLat = 0, prevLng = 0;
  for (const [lat, lng] of points) {
    const lat5 = Math.round(lat * 1e5);
    const lng5 = Math.round(lng * 1e5);
    output += encodeSignedNumber(lat5 - prevLat);
    output += encodeSignedNumber(lng5 - prevLng);
    prevLat = lat5;
    prevLng = lng5;
  }
  return output;
}

function encodeSignedNumber(num) {
  let sgnNum = num << 1;
  if (num < 0) sgnNum = ~sgnNum;
  return encodeNumber(sgnNum);
}

function encodeNumber(num) {
  let output = '';
  while (num >= 0x20) {
    output += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
    num >>= 5;
  }
  output += String.fromCharCode(num + 63);
  return output;
}

module.exports = { getRoute, encodePolyline };
