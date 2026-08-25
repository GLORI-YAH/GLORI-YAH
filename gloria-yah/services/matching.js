const pool = require('../db/pool');

const OFFER_TIMEOUT_SECONDS = 20; // délai laissé au pilote pour accepter avant de passer au suivant
const DEFAULT_MATCH_RADIUS_KM = 8; // rayon de recherche d'un pilote disponible

/**
 * Cherche le pilote disponible le plus proche du point de prise en charge,
 * en excluant ceux qui ont déjà refusé cette course.
 * Renvoie null si aucun pilote disponible dans le rayon.
 */
async function findNearestAvailableDriver(pickupLat, pickupLng, excludeDriverIds = [], radiusKm = DEFAULT_MATCH_RADIUS_KM) {
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.driver_photo_url,
            ST_Distance(u.current_position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_m
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     WHERE u.role = 'CHAUFFEUR'
       AND u.is_online = true
       AND u.current_position IS NOT NULL
       AND NOT (u.id = ANY($3::uuid[]))
       AND ST_DWithin(u.current_position, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
       AND w.balance > w.negative_floor
       AND w.is_blocked = false
     ORDER BY distance_m ASC
     LIMIT 1`,
    [pickupLng, pickupLat, excludeDriverIds, radiusKm * 1000]
  );
  return result.rows[0] || null;
}

/**
 * Propose une course à un pilote : marque la course avec ce candidat et un
 * délai d'expiration. Le pilote doit accepter via /rides/:id/offer/accept
 * avant l'expiration, sinon l'offre repart automatiquement vers le suivant.
 */
async function offerRideToDriver(rideId, driverId) {
  const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000);
  await pool.query(
    `UPDATE rides SET candidate_driver_id = $2, offer_expires_at = $3 WHERE id = $1`,
    [rideId, driverId, expiresAt]
  );
  return expiresAt;
}

/**
 * Point d'entrée principal : tente de trouver et proposer la course au
 * pilote disponible le plus proche. Appelé à la création de la course, et à
 * chaque refus/expiration pour relancer vers le pilote suivant.
 */
async function attemptMatch(ride) {
  const pickup = await pool.query(
    `SELECT ST_Y(pickup_point::geometry) AS lat, ST_X(pickup_point::geometry) AS lng, declined_driver_ids
     FROM rides WHERE id = $1`,
    [ride.id]
  );
  const { lat, lng, declined_driver_ids } = pickup.rows[0];

  const driver = await findNearestAvailableDriver(lat, lng, declined_driver_ids || []);
  if (!driver) {
    return { matched: false, reason: 'Aucun pilote disponible à proximité pour le moment' };
  }

  const expiresAt = await offerRideToDriver(ride.id, driver.id);
  return { matched: true, candidate: driver, offer_expires_at: expiresAt };
}

module.exports = { findNearestAvailableDriver, offerRideToDriver, attemptMatch, OFFER_TIMEOUT_SECONDS };
