// Recherche d'adresse en texte, avec suggestions — comme Yango/Gozem.
//
// DEUX SOURCES combinées :
// 1. LOCAL_PLACES : une liste de quartiers/lieux qu'on connaît avec certitude
//    (coordonnées vérifiées), à faire grandir au fil du temps — les petits
//    quartiers d'Afrique de l'Ouest sont souvent mal référencés sur les services
//    de cartographie gratuits.
// 2. Nominatim (OpenStreetMap) : recherche générale en complément, gratuite mais
//    avec une couverture locale parfois incomplète.
//
// ⚠️ Nominatim impose une limite d'usage (~1 requête/seconde) — pas fait pour un
// vrai trafic de production. Avant un vrai lancement : remplacer par Google
// Places Autocomplete ou Mapbox Geocoding (payants mais robustes à l'échelle).

// Liste locale de quartiers vérifiés — AJOUTER ICI au fur et à mesure.
// Coordonnées trouvées/vérifiées manuellement, pas génériques.
const LOCAL_PLACES = [
  { name: 'Akpakpa', lat: 6.3664, lng: 2.4558, countryCode: 'BJ' },
  // Ajouter la suite ici, même format : { name: '...', lat: ..., lng: ..., countryCode: 'BJ' },
];

/**
 * Convertit des coordonnées en adresse lisible (nécessaire pour les
 * "destinations récentes", stockées uniquement en lat/lng en base).
 */
async function reverseGeocode(lat, lng) {
  try {
    const params = new URLSearchParams({ lat, lon: lng, format: 'json' });
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'Accept-Language': 'fr' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch (err) {
    return null;
  }
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const COVERED_COUNTRY_CODES = 'bj,tg,ci,sn,ne,ml,bf,gw,gh,gn,sl,lr,gm,cv';

function searchLocalPlaces(query) {
  const q = query.trim().toLowerCase();
  return LOCAL_PLACES
    .filter(p => p.name.toLowerCase().includes(q))
    .map(p => ({ label: p.name, lat: p.lat, lng: p.lng, countryCode: p.countryCode }));
}

async function searchNominatim(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    countrycodes: COVERED_COUNTRY_CODES,
    limit: 5,
    addressdetails: 1,
  });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, { headers: { 'Accept-Language': 'fr' } });
  if (!res.ok) throw new Error('Recherche indisponible');
  const results = await res.json();
  return results.map(r => ({
    label: r.display_name,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    countryCode: (r.address && r.address.country_code) ? r.address.country_code.toUpperCase() : null,
  }));
}

/**
 * Combine la liste locale (fiable, instantanée) et Nominatim (couverture large,
 * réseau). Si Nominatim échoue, on garde quand même les résultats locaux.
 */
async function searchAddress(query) {
  if (!query || query.trim().length < 3) return [];

  const localResults = searchLocalPlaces(query);

  let networkResults = [];
  try {
    networkResults = await searchNominatim(query);
  } catch (err) {
    // Silencieux : les résultats locaux restent utilisables même si le réseau échoue.
  }

  // Résultats locaux en premier, puis réseau, sans dépasser 5 suggestions au total.
  return [...localResults, ...networkResults].slice(0, 5);
}

/**
 * Branche un champ <input> texte à un menu de suggestions déroulant.
 * onSelect(place) est appelé quand l'utilisateur clique une suggestion,
 * avec { label, lat, lng, countryCode }.
 */
function attachAddressAutocomplete(inputEl, dropdownEl, onSelect) {
  let debounceTimer = null;

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = inputEl.value;
    debounceTimer = setTimeout(async () => {
      const results = await searchAddress(query);
      renderSuggestions(results);
    }, 400);
  });

  function renderSuggestions(results) {
    if (results.length === 0) {
      dropdownEl.style.display = 'none';
      dropdownEl.innerHTML = '';
      return;
    }
    dropdownEl.innerHTML = results.map((r, i) =>
      `<div class="addr-suggestion" data-idx="${i}">${r.label}</div>`
    ).join('');
    dropdownEl.style.display = 'block';

    dropdownEl.querySelectorAll('.addr-suggestion').forEach((el, i) => {
      el.addEventListener('click', () => {
        const place = results[i];
        inputEl.value = place.label;
        dropdownEl.style.display = 'none';
        onSelect(place);
      });
    });
  }

  document.addEventListener('click', (e) => {
    if (e.target !== inputEl) dropdownEl.style.display = 'none';
  });
}
