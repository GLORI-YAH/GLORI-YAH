// Logique métier centrale : politique "Prix Plafond Garanti"
// Le passager paie toujours le PLUS BAS entre l'estimation initiale et le compteur réel.

/**
 * Distance à vol d'oiseau (Haversine), en km.
 * Un facteur de correction routière (par défaut 1.3) l'approche d'une distance réelle
 * en l'absence d'un moteur de routing (Mapbox/Google Directions) branché en production.
 */
function haversineKm(lat1, lng1, lat2, lng2, roadFactor = 1.3) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * roadFactor;
}

/** Estimation de temps de trajet (min) à partir de la distance, vitesse moyenne urbaine ~25 km/h */
function estimateDurationMin(distanceKm, avgSpeedKmh = 25) {
  return (distanceKm / avgSpeedKmh) * 60;
}

/**
 * Calcule un prix à partir d'une règle tarifaire à deux zones (ville/banlieue),
 * la même structure que celle utilisée publiquement par Yango à Cotonou :
 * un tarif par km s'applique jusqu'à city_radius_km, un tarif différent au-delà.
 *
 * fareRule : { base_fee, included_km, city_radius_km, cost_per_km_city,
 *              cost_per_km_suburb, cost_per_min, minimum_fare }
 */
function computeFare(fareRule, distanceKm, durationMin) {
  const includedKm = Number(fareRule.included_km ?? 0);
  const cityRadius = Number(fareRule.city_radius_km ?? Infinity);

  const billableKm = Math.max(0, distanceKm - includedKm);
  const cityKm = Math.min(billableKm, Math.max(0, cityRadius - includedKm));
  const suburbKm = Math.max(0, billableKm - cityKm);

  const raw =
    Number(fareRule.base_fee) +
    cityKm * Number(fareRule.cost_per_km_city) +
    suburbKm * Number(fareRule.cost_per_km_suburb) +
    durationMin * Number(fareRule.cost_per_min);

  return Math.max(raw, Number(fareRule.minimum_fare));
}

/**
 * Prix Plafond Garanti : à la clôture de la course, le prix final ne peut jamais
 * dépasser l'estimation initiale annoncée au passager.
 */
function applyPriceCeiling(estimatePrice, meterFinalPrice) {
  return Math.min(Number(estimatePrice), Number(meterFinalPrice));
}

/**
 * Politique "Zéro Majoration" : le PRIX PASSAGER n'augmente jamais pour cause de
 * trafic, pluie ou week-end. À la place, GLORI-YAH absorbe la difficulté en
 * réduisant SA PROPRE commission, pour que le chauffeur garde davantage — jamais
 * l'inverse. Si plusieurs conditions s'appliquent en même temps, on retient la
 * plus favorable au chauffeur (le taux le plus bas), sans les cumuler.
 *
 * conditions : { isWeekend, isRaining, isHeavyTraffic }
 */
function computeCommissionRate(baseRate, conditions = {}) {
  const candidates = [Number(baseRate)];
  if (conditions.isWeekend) candidates.push(0.05);
  if (conditions.isRaining) candidates.push(0.04);
  if (conditions.isHeavyTraffic) candidates.push(0.05);
  return Math.min(...candidates);
}

/** Embouteillage important : le trajet réel a pris nettement plus de temps que l'estimation initiale */
function isHeavyTrafficCondition(actualDurationMin, estimatedDurationMin, threshold = 1.5) {
  if (!estimatedDurationMin || estimatedDurationMin <= 0) return false;
  return actualDurationMin >= estimatedDurationMin * threshold;
}

/** Bénin/Afrique de l'Ouest : week-end = samedi/dimanche (à ajuster si un pays a un calendrier différent) */
function isWeekendDate(date) {
  const day = date.getDay(); // 0 = dimanche, 6 = samedi
  return day === 0 || day === 6;
}

module.exports = {
  haversineKm,
  estimateDurationMin,
  computeFare,
  applyPriceCeiling,
  computeCommissionRate,
  isHeavyTrafficCondition,
  isWeekendDate,
};
