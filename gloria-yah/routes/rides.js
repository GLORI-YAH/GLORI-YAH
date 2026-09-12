const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { computeFare, applyPriceCeiling, computeCommissionRate, isHeavyTrafficCondition, isWeekendDate, isWithinLaunchWeek } = require('../services/pricing');
const { getRoute } = require('../services/googleMaps');
const { attemptMatch, OFFER_TIMEOUT_SECONDS } = require('../services/matching');
const { notifierMiseAJourCourse } = require('../services/socket');
const { checkAndRewardReferrer } = require('../services/referral');
const { computeLoyaltyReward } = require('../services/loyalty');
const { verifyKkiapayTransaction } = require('../services/kkiapay');
const { verifyFedaPayTransaction } = require('../services/fedapay');

const router = express.Router();

async function getFareRule(countryId, serviceTier) {
  const result = await pool.query(
    `SELECT * FROM fare_rules WHERE country_id = $1 AND service_tier = $2 AND active = true LIMIT 1`,
    [countryId, serviceTier]
  );
  return result.rows[0] || null;
}

// POST /api/v1/rides/estimate — public, pas besoin d'être connecté pour voir un prix indicatif
router.post('/estimate', async (req, res) => {
  const { pickup, destination, service_tier = 'ESSENTIEL', country_id = 'BJ' } = req.body;
  if (!pickup || !destination) {
    return res.status(400).json({ error: 'pickup et destination sont requis, chacun {lat, lng}' });
  }

  const fareRule = await getFareRule(country_id, service_tier);
  if (!fareRule) {
    return res.status(400).json({ error: `Aucune grille tarifaire active pour ${service_tier} en ${country_id}` });
  }

  const route = await getRoute(pickup, destination);
  const { distanceKm, durationMin } = route;
  const price = computeFare(fareRule, distanceKm, durationMin);

  res.json({
    currency: 'XOF',
    service_tier,
    estimate_price: Math.round(price),
    surge_applied: false, // politique zéro majoration — toujours false
    distance_km: Math.round(distanceKm * 10) / 10,
    eta_minutes: Math.round(durationMin),
    route_polyline: route.polyline, // null si repli Haversine — le frontend trace alors une ligne droite
  });
});

const DELIVERY_TIERS = ['LIVRAISON_MOTO', 'LIVRAISON_VOITURE'];

// POST /api/v1/rides — créer une demande de course (ou de livraison, même infrastructure)
router.post('/', requireAuth, async (req, res) => {
  const {
    pickup, destination, service_tier = 'ESSENTIEL', payment_method, country_id = 'BJ',
    recipient_name, recipient_phone, package_description, share_requested = false,
  } = req.body;
  if (!pickup || !destination || !payment_method) {
    return res.status(400).json({ error: 'pickup, destination et payment_method sont requis' });
  }

  const isDelivery = DELIVERY_TIERS.includes(service_tier);
  if (isDelivery && (!recipient_name || !recipient_phone)) {
    return res.status(400).json({ error: 'recipient_name et recipient_phone sont requis pour une livraison' });
  }
  // Le partage n'a de sens que pour un vrai passager (pas pour une livraison
  // ni un véhicule très spécifique où deux personnes ne monteraient pas
  // ensemble naturellement) — on le restreint sciemment à ces gammes-là.
  const shareEligible = !isDelivery && ['MOTO', 'ESSENTIEL', 'SIGNATURE', 'KLOBOTO'].includes(service_tier);

  const fareRule = await getFareRule(country_id, service_tier);
  if (!fareRule) return res.status(400).json({ error: 'Grille tarifaire indisponible pour ce pays/gamme' });

  const route = await getRoute(pickup, destination);
  const { distanceKm, durationMin } = route;
  const estimatePrice = computeFare(fareRule, distanceKm, durationMin);

  try {
    // PARTAGE DE COURSE : avant de créer une nouvelle course indépendante, on
    // cherche une course compatible déjà en attente d'un second passager —
    // même pays/gamme, pas encore complète (is_shared = false), départ à
    // moins de 1,5 km, arrivée à moins de 2 km, demandée il y a moins de 5
    // minutes. Formule confirmée par l'utilisateur (04/09) : le prix total
    // partagé = le plus cher des deux trajets solo × 1,2, divisé par 2 —
    // chacun paie moins que seul, la course rapporte un peu plus au pilote.
    if (share_requested && shareEligible) {
      const candidat = await pool.query(
        `SELECT id, passenger_id, estimate_price, distance_km, duration_min
         FROM rides
         WHERE share_requested = true AND is_shared = false
           AND status = 'REQUESTED' AND country_id = $1 AND service_tier = $2
           AND passenger_id != $3
           AND requested_at > now() - interval '5 minutes'
           AND ST_DWithin(pickup_point, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, 1500)
           AND ST_DWithin(destination_point, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, 2000)
         ORDER BY requested_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [country_id, service_tier, req.user.id, pickup.lng, pickup.lat, destination.lng, destination.lat]
      );

      if (candidat.rows[0]) {
        const original = candidat.rows[0];
        const soloOriginal = Number(original.estimate_price);
        const soloNouveau = Math.round(estimatePrice);
        const prixTotalPartage = Math.max(soloOriginal, soloNouveau) * 1.2;
        const partPourChacun = Math.round(prixTotalPartage / 2);

        await pool.query(`UPDATE rides SET is_shared = true, estimate_price = $2 WHERE id = $1`, [original.id, partPourChacun]);
        const shareResult = await pool.query(
          `INSERT INTO ride_shares (ride_id, passenger_id, pickup_point, destination_point, price_share)
           VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, $7)
           RETURNING id`,
          [original.id, req.user.id, pickup.lng, pickup.lat, destination.lng, destination.lat, partPourChacun]
        );

        // Le premier passager voit son prix baisser sans rien avoir à faire —
        // notification instantanée (WebSocket déjà en place), sondage en filet de secours.
        notifierMiseAJourCourse(original.passenger_id, { ride_id: original.id, status: 'SHARE_MATCHED', new_price: partPourChacun });

        return res.status(201).json({
          id: original.id,
          ride_share_id: shareResult.rows[0].id,
          status: 'REQUESTED',
          estimate_price: partPourChacun,
          distance_km: distanceKm,
          duration_min: durationMin,
          service_tier,
          is_shared: true,
          route_polyline: route.polyline,
          matching: { matched: false, reason: 'Course déjà en recherche de pilote (partagée)' },
        });
      }
    }

    const result = await pool.query(
      `INSERT INTO rides
        (passenger_id, fare_rule_id, country_id, currency_code, service_tier,
         pickup_point, destination_point, status, distance_km, duration_min,
         estimate_price, payment_method, route_polyline,
         recipient_name, recipient_phone, package_description, share_requested)
       VALUES ($1, $2, $3, 'XOF', $4,
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
         'REQUESTED', $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id, status, estimate_price, distance_km, duration_min, service_tier`,
      [
        req.user.id, fareRule.id, country_id, service_tier,
        pickup.lng, pickup.lat, destination.lng, destination.lat,
        distanceKm, durationMin, Math.round(estimatePrice), payment_method, route.polyline,
        isDelivery ? recipient_name : null,
        isDelivery ? recipient_phone : null,
        isDelivery ? (package_description || null) : null,
        share_requested && shareEligible,
      ]
    );

    const ride = result.rows[0];

    // Tentative immédiate de trouver un pilote disponible à proximité.
    // Si personne n'est disponible maintenant, la course reste REQUESTED —
    // en production, un job périodique relancerait la recherche régulièrement.
    const matchResult = await attemptMatch(ride);

    res.status(201).json({ ...ride, matching: matchResult, route_polyline: route.polyline });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la création de la course' });
  }
});

// GET /api/v1/rides/:id — ce que le passager voit avant embarquement
// NOTE MVP : l'expiration d'une offre pilote non honorée est gérée ici, "à la demande"
// (quand quelqu'un consulte la course), pas par un vrai job d'arrière-plan planifié.
// En production, un job périodique (ex. toutes les 5 secondes) serait plus robuste et
// réactif, indépendamment du fait que quelqu'un consulte la course ou non.
router.get('/:id', requireAuth, async (req, res) => {
  const current = await pool.query(
    `SELECT status, candidate_driver_id, offer_expires_at, declined_driver_ids,
            passenger_id, driver_id
     FROM rides WHERE id = $1`,
    [req.params.id]
  );
  if (!current.rows[0]) return res.status(404).json({ error: 'Course introuvable' });

  const c = current.rows[0];
  const owns = c.passenger_id === req.user.id || c.driver_id === req.user.id;
  if (!owns && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Cette course ne vous appartient pas' });
  }

  if (c.status === 'REQUESTED' && c.candidate_driver_id && new Date(c.offer_expires_at) < new Date()) {
    const declined = [...(c.declined_driver_ids || []), c.candidate_driver_id];
    await pool.query(
      `UPDATE rides SET declined_driver_ids = $2, candidate_driver_id = NULL, offer_expires_at = NULL WHERE id = $1`,
      [req.params.id, declined]
    );
    await attemptMatch({ id: req.params.id });
  }

  const result = await pool.query(
    `SELECT r.id, r.passenger_id, r.driver_id, r.status, r.service_tier,
            r.distance_km, r.duration_min, r.estimate_price, r.meter_final_price, r.final_price,
            r.payment_method, r.vehicle_check_confirmed, r.requested_at, r.started_at, r.completed_at,
            r.route_polyline, r.recipient_name, r.recipient_phone, r.package_description,
            ST_Y(r.pickup_point::geometry) AS pickup_lat, ST_X(r.pickup_point::geometry) AS pickup_lng,
            ST_Y(r.destination_point::geometry) AS dest_lat, ST_X(r.destination_point::geometry) AS dest_lng,
            p.full_name AS passenger_name, p.phone_number AS passenger_phone
     FROM rides r
     LEFT JOIN users p ON p.id = r.passenger_id
     WHERE r.id = $1`,
    [req.params.id]
  );
  res.json(result.rows[0]);
});

// GET /api/v1/rides/:id/driver-card — photo pilote + véhicule, une fois la course MATCHED
router.get('/:id/driver-card', requireAuth, async (req, res) => {
  const ride = await pool.query('SELECT driver_id FROM rides WHERE id = $1', [req.params.id]);
  if (!ride.rows[0] || !ride.rows[0].driver_id) {
    return res.json({ available: false });
  }

  const driverId = ride.rows[0].driver_id;
  const result = await pool.query(
    `SELECT u.full_name, u.driver_photo_url, u.rating_avg,
            v.plate_number, v.color, v.photo_url AS vehicle_photo_url, v.make, v.model,
            (
              -- Doit correspondre à REQUIRED_KYC_DOC_TYPES dans routes/drivers.js (PERMIS + SELFIE)
              SELECT COUNT(DISTINCT doc_type) FROM kyc_documents
              WHERE user_id = u.id AND status = 'VERIFIED' AND doc_type IN ('PERMIS', 'SELFIE')
            ) = 2 AS kyc_verified
     FROM users u
     LEFT JOIN vehicles v ON v.owner_id = u.id OR v.assigned_driver_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [driverId]
  );

  if (!result.rows[0]) return res.json({ available: false });
  res.json({ available: true, ...result.rows[0] });
});

// PATCH /api/v1/rides/:id/status — transitions REQUESTED -> MATCHED -> ONGOING -> COMPLETED/CANCELLED
router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status, reason } = req.body;
  // CORRECTIF SÉCURITÉ (audit 31/08/2026) : 'MATCHED' a été retiré des statuts
  // autorisés ici. L'ancien code acceptait un driver_id fourni directement
  // dans le corps de la requête SANS vérifier qu'il correspondait à un pilote
  // ayant réellement accepté l'offre — un passager malveillant aurait pu
  // s'auto-assigner n'importe quel pilote de son choix. La seule voie légitime
  // vers MATCHED est /rides/:id/offer/accept, qui vérifie correctement que le
  // pilote est bien candidate_driver_id sur cette course précise.
  const allowed = ['ONGOING', 'COMPLETED', 'CANCELLED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'status invalide' });

  // La raison d'annulation est obligatoire (protection anti-fraude, voir
  // migration 023) — un passager ne peut plus juste "annuler" sans dire pourquoi.
  const CANCEL_REASONS = ['CHANGEMENT_AVIS', 'TROP_LONG', 'ADRESSE_ERREUR', 'CHAUFFEUR_DEMANDE_ANNULATION', 'AUTRE'];
  if (status === 'CANCELLED' && !CANCEL_REASONS.includes(reason)) {
    return res.status(400).json({ error: `reason est requis et doit être l'un de : ${CANCEL_REASONS.join(', ')}` });
  }

  // Sécurité : seuls le passager ou le pilote de CETTE course peuvent en changer le statut
  const rideCheck = await pool.query('SELECT passenger_id, driver_id, status AS current_status FROM rides WHERE id = $1', [req.params.id]);
  if (!rideCheck.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  const owns = rideCheck.rows[0].passenger_id === req.user.id || rideCheck.rows[0].driver_id === req.user.id;
  if (!owns && req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Cette course ne vous appartient pas' });

  // Une annulation n'a de sens que tant que la course n'est pas déjà terminée
  if (status === 'CANCELLED' && ['COMPLETED', 'CANCELLED'].includes(rideCheck.rows[0].current_status)) {
    return res.status(400).json({ error: 'Cette course est déjà terminée ou annulée' });
  }

  const fields = ['status = $2'];
  const values = [req.params.id, status];

  if (status === 'ONGOING') fields.push('started_at = now()');
  if (status === 'CANCELLED') {
    fields.push('cancelled_at = now()');
    values.push(reason);
    fields.push(`cancellation_reason = $${values.length}`);
    values.push(req.user.id);
    fields.push(`cancelled_by = $${values.length}`);
  }

  const result = await pool.query(
    `UPDATE rides SET ${fields.join(', ')} WHERE id = $1 RETURNING id, status`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  notifierMiseAJourCourse(rideCheck.rows[0].passenger_id, { ride_id: req.params.id, status });

  // PROTECTION ANTI-FRAUDE : si le passager signale que LE PILOTE lui a demandé
  // d'annuler pour négocier hors plateforme, on compte ce signalement. À partir
  // de 3 signalements (après la dernière revue admin), le pilote est bloqué
  // automatiquement — suivre sans sanctionner ne préviendrait rien.
  if (status === 'CANCELLED' && reason === 'CHAUFFEUR_DEMANDE_ANNULATION' && rideCheck.rows[0].driver_id) {
    await verifierEtBloquerPiloteSiFraude(rideCheck.rows[0].driver_id);
  }

  res.json(result.rows[0]);
});

// Compte les signalements "le pilote m'a demandé d'annuler pour négocier hors
// plateforme" pour ce pilote (depuis sa dernière revue admin, voir
// fraud_flags_cleared_at) — bloque automatiquement à partir de 3.
async function verifierEtBloquerPiloteSiFraude(driverId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS nb FROM rides r
       JOIN users u ON u.id = $1
       WHERE r.driver_id = $1 AND r.cancellation_reason = 'CHAUFFEUR_DEMANDE_ANNULATION'
         AND r.cancelled_at > COALESCE(u.fraud_flags_cleared_at, '1970-01-01')`,
      [driverId]
    );
    const nb = Number(result.rows[0].nb);
    if (nb >= 3) {
      await pool.query('UPDATE users SET is_online = false WHERE id = $1', [driverId]);
      const walletResult = await pool.query('SELECT id FROM wallets WHERE user_id = $1', [driverId]);
      if (walletResult.rows[0]) {
        await pool.query('UPDATE wallets SET is_blocked = true WHERE id = $1', [walletResult.rows[0].id]);
      }
      console.warn(`Pilote ${driverId} bloqué automatiquement : ${nb} signalements de demande d'annulation hors plateforme.`);
    }
  } catch (err) {
    console.error('Erreur vérification anti-fraude annulation :', err.message);
  }
}

// POST /api/v1/rides/:id/offer/accept — le pilote accepte la course qui lui a été proposée
router.post('/:id/offer/accept', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rideResult = await client.query(
      `SELECT id, candidate_driver_id, offer_expires_at, vehicle_id, passenger_id FROM rides WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const ride = rideResult.rows[0];
    if (!ride) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Course introuvable' }); }

    if (ride.candidate_driver_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Cette course ne vous a pas été proposée' });
    }
    if (new Date(ride.offer_expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'Offre expirée — une nouvelle recherche de pilote a probablement déjà démarré' });
    }

    await client.query(
      `UPDATE rides SET status = 'MATCHED', driver_id = $2, started_at = NULL
       WHERE id = $1`,
      [req.params.id, req.user.id]
    );
    await client.query('COMMIT');
    notifierMiseAJourCourse(ride.passenger_id, { ride_id: req.params.id, status: 'MATCHED' });
    res.json({ status: 'MATCHED', driver_id: req.user.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'acceptation' });
  } finally {
    client.release();
  }
});

// POST /api/v1/rides/:id/offer/decline — le pilote refuse : relance automatique vers le pilote suivant
router.post('/:id/offer/decline', requireAuth, async (req, res) => {
  const rideResult = await pool.query(
    `SELECT id, candidate_driver_id, declined_driver_ids FROM rides WHERE id = $1`,
    [req.params.id]
  );
  const ride = rideResult.rows[0];
  if (!ride) return res.status(404).json({ error: 'Course introuvable' });
  if (ride.candidate_driver_id !== req.user.id) {
    return res.status(403).json({ error: 'Cette course ne vous a pas été proposée' });
  }

  const declined = [...(ride.declined_driver_ids || []), req.user.id];
  await pool.query(
    `UPDATE rides SET declined_driver_ids = $2, candidate_driver_id = NULL, offer_expires_at = NULL WHERE id = $1`,
    [req.params.id, declined]
  );

  const matchResult = await attemptMatch({ id: req.params.id });
  res.json({ declined: true, next_match: matchResult });
});

// POST /api/v1/rides/:id/vehicle-check — le passager confirme avoir vérifié plaque/couleur/photo avant embarquement
router.post('/:id/vehicle-check', requireAuth, async (req, res) => {
  const rideCheck = await pool.query('SELECT passenger_id FROM rides WHERE id = $1', [req.params.id]);
  if (!rideCheck.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  if (rideCheck.rows[0].passenger_id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Cette course ne vous appartient pas' });
  }

  const result = await pool.query(
    `UPDATE rides SET vehicle_check_confirmed = true, vehicle_check_confirmed_at = now()
     WHERE id = $1 RETURNING id, vehicle_check_confirmed`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  res.json(result.rows[0]);
});

// POST /api/v1/rides/:id/meter/tick — le chauffeur pousse périodiquement sa position pendant la course
router.post('/:id/meter/tick', requireAuth, async (req, res) => {
  const { lat, lng, elapsed_min, distance_km } = req.body;
  if (lat == null || lng == null || elapsed_min == null || distance_km == null) {
    return res.status(400).json({ error: 'lat, lng, elapsed_min, distance_km sont requis' });
  }

  const rideResult = await pool.query(
    `SELECT r.id, r.driver_id, r.fare_rule_id, fr.base_fee, fr.included_km, fr.city_radius_km,
            fr.cost_per_km_city, fr.cost_per_km_suburb, fr.cost_per_min, fr.minimum_fare
     FROM rides r JOIN fare_rules fr ON fr.id = r.fare_rule_id
     WHERE r.id = $1`,
    [req.params.id]
  );
  const ride = rideResult.rows[0];
  if (!ride) return res.status(404).json({ error: 'Course introuvable' });
  if (ride.driver_id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Cette course ne vous appartient pas' });
  }

  const runningPrice = computeFare(ride, distance_km, elapsed_min);

  await pool.query(
    `INSERT INTO ride_meter_ticks (ride_id, position, elapsed_min, distance_km, running_price)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5, $6)`,
    [req.params.id, lng, lat, elapsed_min, distance_km, runningPrice]
  );

  res.json({ running_price: Math.round(runningPrice) });
});

// POST /api/v1/rides/:id/conditions — le chauffeur déclare des conditions difficiles (pluie)
// MVP : auto-déclaratif. À remplacer par une vraie API météo géolocalisée en production
// (ex. déclenchement automatique si l'API météo confirme de la pluie sur la zone pickup).
router.post('/:id/conditions', requireAuth, async (req, res) => {
  const { rain } = req.body;
  const rideCheck = await pool.query('SELECT driver_id FROM rides WHERE id = $1', [req.params.id]);
  if (!rideCheck.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  if (rideCheck.rows[0].driver_id !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Cette course ne vous appartient pas' });
  }

  const result = await pool.query(
    `UPDATE rides SET rain_flag = $2 WHERE id = $1 RETURNING id, rain_flag`,
    [req.params.id, !!rain]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  res.json(result.rows[0]);
});

// POST /api/v1/rides/:id/complete — clôture : applique le Prix Plafond Garanti + commission adaptative
router.post('/:id/complete', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rideResult = await client.query(
      `SELECT r.*, fr.commission_rate FROM rides r
       JOIN fare_rules fr ON fr.id = r.fare_rule_id
       WHERE r.id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const ride = rideResult.rows[0];
    if (!ride) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Course introuvable' }); }
    if (ride.driver_id !== req.user.id && ride.passenger_id !== req.user.id && req.user.role !== 'ADMIN') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Cette course ne vous appartient pas' });
    }

    // Idempotence : si un appel précédent a déjà clôturé la course (ex. réponse
    // perdue à cause d'une coupure réseau, et le pilote a retenté), on renvoie
    // simplement le résultat déjà enregistré au lieu de redébiter la commission
    // une seconde fois sur le wallet du pilote.
    if (ride.status === 'COMPLETED') {
      await client.query('ROLLBACK');
      return res.json({
        status: 'COMPLETED',
        meter_final_price: Math.round(Number(ride.meter_final_price)),
        estimate_price: Math.round(Number(ride.estimate_price)),
        final_price: Math.round(Number(ride.final_price)),
        already_completed: true,
      });
    }

    const lastTick = await client.query(
      `SELECT running_price FROM ride_meter_ticks WHERE ride_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [req.params.id]
    );
    const meterFinalPrice = lastTick.rows[0]
      ? Number(lastTick.rows[0].running_price)
      : Number(ride.estimate_price); // pas de tick reçu -> on retombe sur l'estimation

    // *** LA RÈGLE CENTRALE DU PRODUIT : le passager ne paie jamais plus que l'estimation ***
    const ridePriceForDriver = applyPriceCeiling(ride.estimate_price, meterFinalPrice); // base de calcul chauffeur, jamais réduite par un crédit marketing

    // Applique un crédit "course gratuite" de parrainage si le passager en a un.
    // Le chauffeur est payé sur ridePriceForDriver, pas sur le montant réduit —
    // c'est GLORI-YAH qui absorbe le coût du parrainage, jamais le chauffeur.
    let creditUsed = 0;
    let finalPrice = ridePriceForDriver;
    const passengerCredit = await client.query(
      'SELECT free_ride_credit_fcfa FROM users WHERE id = $1 FOR UPDATE',
      [ride.passenger_id]
    );
    const availableCredit = Number(passengerCredit.rows[0]?.free_ride_credit_fcfa || 0);
    if (availableCredit > 0) {
      creditUsed = Math.min(availableCredit, finalPrice);
      finalPrice -= creditUsed; // c'est CE montant que le passager paie réellement
      await client.query(
        'UPDATE users SET free_ride_credit_fcfa = free_ride_credit_fcfa - $2 WHERE id = $1',
        [ride.passenger_id, creditUsed]
      );
    }

    // Programme de fidélité (promotion limitée à 3 mois) : les grosses courses
    // (>2000 FCFA) rapportent 100 FCFA de crédit au passager pour SA PROCHAINE
    // course — jamais sur celle-ci (le crédit gagné maintenant ne réduit pas
    // rétroactivement ce qu'il vient de payer).
    const loyaltyReward = computeLoyaltyReward(ridePriceForDriver);
    if (loyaltyReward > 0) {
      await client.query(
        'UPDATE users SET free_ride_credit_fcfa = free_ride_credit_fcfa + $2 WHERE id = $1',
        [ride.passenger_id, loyaltyReward]
      );
    }

    await client.query(
      `UPDATE rides SET status = 'COMPLETED', meter_final_price = $2, final_price = $3, completed_at = now()
       WHERE id = $1`,
      [req.params.id, Math.round(meterFinalPrice), Math.round(finalPrice)]
    );

    // Commission plateforme adaptative — le PRIX PASSAGER ne change jamais (zéro majoration),
    // c'est la part de GLORI-YAH qui se réduit dans les conditions difficiles.
    if (ride.driver_id) {
      const lastElapsed = await client.query(
        `SELECT elapsed_min FROM ride_meter_ticks WHERE ride_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [req.params.id]
      );
      const actualDurationMin = lastElapsed.rows[0] ? Number(lastElapsed.rows[0].elapsed_min) : Number(ride.duration_min);

      const driverInfo = await client.query('SELECT created_at, commission_override FROM users WHERE id = $1', [ride.driver_id]);
      const conditions = {
        isWeekend: isWeekendDate(new Date()),
        isRaining: !!ride.rain_flag,
        isHeavyTraffic: isHeavyTrafficCondition(actualDurationMin, Number(ride.duration_min)),
        isNewDriverLaunchWeek: isWithinLaunchWeek(driverInfo.rows[0]?.created_at),
      };
      // Un pilote avec un taux personnalisé (compte gratuit ou promo décidée
      // par l'admin) ignore complètement la grille tarifaire standard et les
      // conditions (weekend/pluie/trafic) — sa commission reste fixe, telle
      // que l'admin l'a définie.
      const commissionOverride = driverInfo.rows[0]?.commission_override;
      let appliedCommissionRate;
      if (commissionOverride !== null && commissionOverride !== undefined) {
        appliedCommissionRate = Number(commissionOverride);
      } else {
        // Zone géographique (aéroport, etc.) : commission ajustée pour cette
        // zone précise si la prise en charge y tombe — ne touche JAMAIS le
        // prix passager, uniquement la part GLORI-YAH (cohérent avec "Zéro
        // Majoration"). Prend la zone la plus généreuse pour le pilote si
        // plusieurs zones actives se chevauchent.
        const zoneMatch = await client.query(
          `SELECT zone_commission_rate FROM pricing_zones
           WHERE active = true
             AND ST_DWithin(
               (SELECT pickup_point FROM rides WHERE id = $1),
               ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326)::geography,
               radius_km * 1000
             )
           ORDER BY zone_commission_rate ASC LIMIT 1`,
          [req.params.id]
        );
        appliedCommissionRate = zoneMatch.rows[0]
          ? Number(zoneMatch.rows[0].zone_commission_rate)
          : computeCommissionRate(ride.commission_rate, conditions);
      }
      const commission = Math.round(ridePriceForDriver * appliedCommissionRate);

      const walletResult = await client.query('SELECT id, balance, negative_floor FROM wallets WHERE user_id = $1 FOR UPDATE', [ride.driver_id]);
      const wallet = walletResult.rows[0];
      if (wallet) {
        // CORRECTIF CRITIQUE : pour une course payée autrement qu'en espèces
        // (Kkiapay/FedaPay), le PASSAGER paie la plateforme en entier via
        // /passenger-payment — le pilote n'a jamais touché l'argent physiquement.
        // Sans ce crédit, seule la commission serait débitée : le pilote
        // perdrait de l'argent sur chaque course non-cash. En espèces, le
        // pilote a déjà le cash en main : seule la commission doit être
        // débitée, PAS de crédit (sinon on le paierait deux fois).
        const isCash = ride.payment_method === 'CASH';
        // Le pilote est payé sur ridePriceForDriver (montant plein), jamais sur
        // finalPrice (qui peut être réduit par un crédit parrainage) — c'est
        // GLORI-YAH qui absorbe ce coût-là, jamais le pilote (politique déjà
        // en place, voir le calcul de finalPrice plus haut).
        const netChange = isCash ? -commission : (Math.round(ridePriceForDriver) - commission);
        const newBalance = Number(wallet.balance) + netChange;
        const shouldBlock = newBalance <= Number(wallet.negative_floor);

        await client.query(
          'UPDATE wallets SET balance = $2, is_blocked = $3, updated_at = now() WHERE id = $1',
          [wallet.id, newBalance, shouldBlock]
        );
        await client.query(
          `INSERT INTO wallet_transactions (wallet_id, ride_id, type, amount)
           VALUES ($1, $2, 'COMMISSION_DEBIT', $3)`,
          [wallet.id, req.params.id, -commission]
        );
        if (!isCash) {
          await client.query(
            `INSERT INTO wallet_transactions (wallet_id, ride_id, type, amount)
             VALUES ($1, $2, 'PAYOUT', $3)`,
            [wallet.id, req.params.id, Math.round(ridePriceForDriver)]
          );
        }
      }
    }

    await client.query('COMMIT');
    notifierMiseAJourCourse(ride.passenger_id, { ride_id: req.params.id, status: 'COMPLETED', final_price: Math.round(finalPrice) });

    // Vérifie si ce passager fait franchir un palier de parrainage à son parrain
    // (après le COMMIT, pour ne jamais bloquer la clôture de course si ça échoue).
    let referralResult = null;
    try {
      referralResult = await checkAndRewardReferrer(ride.passenger_id);
    } catch (err) {
      console.error('Erreur non bloquante lors de la vérification de parrainage :', err.message);
    }

    res.json({
      status: 'COMPLETED',
      meter_final_price: Math.round(meterFinalPrice),
      estimate_price: Math.round(ride.estimate_price),
      final_price: Math.round(finalPrice),
      credit_used_fcfa: Math.round(creditUsed),
      saved_vs_estimate: Math.round(ride.estimate_price - ridePriceForDriver),
      referral_milestone_reached: referralResult?.rewarded || false,
      loyalty_credit_earned_fcfa: loyaltyReward,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la clôture de la course' });
  } finally {
    client.release();
  }
});

// POST /api/v1/rides/:id/passenger-payment/init
// Étape 1 : une fois la course COMPLETED avec un mode de paiement non-espèces,
// prépare le paiement du PRIX FINAL EXACT (jamais l'estimation — le passager
// paie précisément ce qu'il doit, ni plus ni moins).
router.post('/:id/passenger-payment/init', requireAuth, async (req, res) => {
  const ride = await pool.query(
    `SELECT id, passenger_id, status, final_price, payment_method, country_id FROM rides WHERE id = $1`,
    [req.params.id]
  );
  const r = ride.rows[0];
  if (!r) return res.status(404).json({ error: 'Course introuvable' });
  if (r.passenger_id !== req.user.id) return res.status(403).json({ error: 'Cette course ne vous appartient pas' });
  if (r.status !== 'COMPLETED') return res.status(400).json({ error: 'Le paiement ne peut être initié qu\'une fois la course terminée' });
  if (r.payment_method === 'CASH') return res.status(400).json({ error: 'Cette course est payée en espèces, rien à prélever' });

  const alreadyPaid = await pool.query(`SELECT id FROM ride_payments WHERE ride_id = $1 AND status = 'PAID'`, [req.params.id]);
  if (alreadyPaid.rows[0]) return res.json({ already_paid: true });

  // CORRECTIF (audit 31/08/2026) : liste de pays codée en dur ici, jamais mise
  // à jour depuis l'ajout de la RDC/Mauritanie/Tchad/Guinée — utilise
  // maintenant la vraie config par pays déjà en base (countries.default_payment_gateways).
  const countryRow = await pool.query('SELECT default_payment_gateways FROM countries WHERE id = $1', [r.country_id]);
  const availableGateways = countryRow.rows[0]?.default_payment_gateways || ['FEDAPAY'];
  const gateway = req.body.gateway || (availableGateways.includes('KKIAPAY') ? 'KKIAPAY' : availableGateways[0]);
  if (!gateway) {
    return res.status(400).json({ error: `Aucune passerelle de paiement configurée pour ce pays (${r.country_id}) — paie en espèces.` });
  }

  if (gateway === 'KKIAPAY') {
    return res.json({
      gateway: 'KKIAPAY',
      public_key: process.env.KKIAPAY_PUBLIC_KEY,
      sandbox: process.env.KKIAPAY_SANDBOX === 'true',
      amount: r.final_price,
    });
  }

  try {
    const baseUrl = process.env.FEDAPAY_ENV === 'live'
      ? 'https://api.fedapay.com/v1'
      : 'https://sandbox-api.fedapay.com/v1';

    const response = await fetch(`${baseUrl}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FEDAPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'Paiement course GLORI-YAH',
        amount: r.final_price,
        currency: { iso: 'XOF' },
      }),
    });

    if (!response.ok) throw new Error(`FedaPay a répondu ${response.status}`);
    const data = await response.json();
    const transaction = data.transaction || data['v1/transaction'] || data;

    // Enregistre immédiatement une ligne PENDING — c'est ce qui permet au
    // webhook FedaPay (appelé indépendamment du client) de retrouver plus
    // tard à quelle course cette transaction correspond.
    await pool.query(
      `INSERT INTO ride_payments (ride_id, gateway, transaction_id, amount, status)
       VALUES ($1, 'FEDAPAY', $2, $3, 'PENDING')
       ON CONFLICT (transaction_id) DO NOTHING`,
      [req.params.id, transaction.id, r.final_price]
    );

    res.json({ gateway: 'FEDAPAY', transaction_id: transaction.id, payment_url: transaction.payment_url, amount: r.final_price });
  } catch (err) {
    console.error('Échec de création de transaction FedaPay (paiement passager) :', err.message);
    res.status(502).json({ error: 'Impossible de préparer le paiement. Réessaie ou paie en espèces.' });
  }
});

// POST /api/v1/rides/:id/passenger-payment/verify
// Étape 2 (LA SEULE qui compte le paiement comme réel) : revérifie depuis le
// serveur avant de marquer la course payée. Jamais de confiance aveugle au frontend.
router.post('/:id/passenger-payment/verify', requireAuth, async (req, res) => {
  const { transaction_id, gateway } = req.body;
  if (!transaction_id || !gateway) return res.status(400).json({ error: 'transaction_id et gateway sont requis' });
  if (!['KKIAPAY', 'FEDAPAY'].includes(gateway)) return res.status(400).json({ error: 'gateway invalide' });

  const ride = await pool.query(
    `SELECT id, passenger_id, final_price FROM rides WHERE id = $1 AND status = 'COMPLETED'`,
    [req.params.id]
  );
  const r = ride.rows[0];
  if (!r) return res.status(404).json({ error: 'Course introuvable ou pas encore terminée' });
  if (r.passenger_id !== req.user.id) return res.status(403).json({ error: 'Cette course ne vous appartient pas' });

  const existing = await pool.query(`SELECT id, status FROM ride_payments WHERE transaction_id = $1`, [transaction_id]);
  // PENDING n'est pas un état final (créé à /init pour FedaPay, avant toute
  // confirmation réelle) — seul PAID/FAILED doit court-circuiter la vérification.
  if (existing.rows[0] && existing.rows[0].status !== 'PENDING') {
    return res.json({ already_processed: true, status: existing.rows[0].status });
  }

  let verification;
  try {
    verification = gateway === 'KKIAPAY'
      ? await verifyKkiapayTransaction(transaction_id)
      : await verifyFedaPayTransaction(transaction_id);
  } catch (err) {
    console.error(`Échec de vérification paiement passager ${gateway} :`, err.message);
    return res.status(502).json({ error: `Impossible de vérifier le paiement auprès de ${gateway}.` });
  }

  if (!verification.success) {
    await pool.query(
      `INSERT INTO ride_payments (ride_id, gateway, transaction_id, amount, status) VALUES ($1, $2, $3, $4, 'FAILED')
       ON CONFLICT (transaction_id) DO UPDATE SET status = 'FAILED'`,
      [req.params.id, gateway, transaction_id, verification.amount || r.final_price]
    );
    return res.status(402).json({ error: `Paiement non confirmé par ${gateway}.` });
  }

  try {
    await pool.query(
      `INSERT INTO ride_payments (ride_id, gateway, transaction_id, amount, status) VALUES ($1, $2, $3, $4, 'PAID')
       ON CONFLICT (transaction_id) DO UPDATE SET status = 'PAID'`,
      [req.params.id, gateway, transaction_id, verification.amount]
    );
    res.json({ paid: true, amount: verification.amount });
  } catch (err) {
    if (err.code === '23505') {
      const dup = await pool.query(`SELECT status FROM ride_payments WHERE transaction_id = $1`, [transaction_id]);
      return res.json({ already_processed: true, status: dup.rows[0].status });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de l\'enregistrement du paiement' });
  }
});

// POST /api/v1/rides/:id/sos
router.post('/:id/sos', requireAuth, async (req, res) => {
  const { lat, lng, reason = 'MANUAL' } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat et lng sont requis' });

  // CORRECTIF SÉCURITÉ (audit 31/08/2026) : aucune vérification n'existait
  // avant — n'importe quel utilisateur connecté pouvait déclencher une alerte
  // SOS sur une course qui n'était pas la sienne.
  const rideCheck = await pool.query('SELECT passenger_id, driver_id FROM rides WHERE id = $1', [req.params.id]);
  if (!rideCheck.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  const owns = rideCheck.rows[0].passenger_id === req.user.id || rideCheck.rows[0].driver_id === req.user.id;
  if (!owns && req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Cette course ne vous appartient pas' });
  }

  const result = await pool.query(
    `INSERT INTO sos_alerts (ride_id, triggered_by, position, reason)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5)
     RETURNING id, status, created_at`,
    [req.params.id, req.user.id, lng, lat, reason]
  );
  // NOTE : brancher ici l'envoi réel (SMS/notification push) au centre de contrôle
  // et aux contacts d'urgence — non implémenté dans ce squelette.
  res.status(201).json(result.rows[0]);
});

module.exports = router;
