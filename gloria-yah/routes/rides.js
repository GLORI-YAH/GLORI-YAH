const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { haversineKm, estimateDurationMin, computeFare, applyPriceCeiling, computeCommissionRate, isHeavyTrafficCondition, isWeekendDate } = require('../services/pricing');
const { attemptMatch, OFFER_TIMEOUT_SECONDS } = require('../services/matching');
const { checkAndRewardReferrer } = require('../services/referral');

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

  const distanceKm = haversineKm(pickup.lat, pickup.lng, destination.lat, destination.lng);
  const durationMin = estimateDurationMin(distanceKm);
  const price = computeFare(fareRule, distanceKm, durationMin);

  res.json({
    currency: 'XOF',
    service_tier,
    estimate_price: Math.round(price),
    surge_applied: false, // politique zéro majoration — toujours false
    distance_km: Math.round(distanceKm * 10) / 10,
    eta_minutes: Math.round(durationMin),
  });
});

// POST /api/v1/rides — créer une demande de course
router.post('/', requireAuth, async (req, res) => {
  const { pickup, destination, service_tier = 'ESSENTIEL', payment_method, country_id = 'BJ' } = req.body;
  if (!pickup || !destination || !payment_method) {
    return res.status(400).json({ error: 'pickup, destination et payment_method sont requis' });
  }

  const fareRule = await getFareRule(country_id, service_tier);
  if (!fareRule) return res.status(400).json({ error: 'Grille tarifaire indisponible pour ce pays/gamme' });

  const distanceKm = haversineKm(pickup.lat, pickup.lng, destination.lat, destination.lng);
  const durationMin = estimateDurationMin(distanceKm);
  const estimatePrice = computeFare(fareRule, distanceKm, durationMin);

  try {
    const result = await pool.query(
      `INSERT INTO rides
        (passenger_id, fare_rule_id, country_id, currency_code, service_tier,
         pickup_point, destination_point, status, distance_km, duration_min,
         estimate_price, payment_method)
       VALUES ($1, $2, $3, 'XOF', $4,
         ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
         ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
         'REQUESTED', $9, $10, $11, $12)
       RETURNING id, status, estimate_price, distance_km, duration_min, service_tier`,
      [
        req.user.id, fareRule.id, country_id, service_tier,
        pickup.lng, pickup.lat, destination.lng, destination.lat,
        distanceKm, durationMin, Math.round(estimatePrice), payment_method,
      ]
    );

    const ride = result.rows[0];

    // Tentative immédiate de trouver un pilote disponible à proximité.
    // Si personne n'est disponible maintenant, la course reste REQUESTED —
    // en production, un job périodique relancerait la recherche régulièrement.
    const matchResult = await attemptMatch(ride);

    res.status(201).json({ ...ride, matching: matchResult });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la création de la course' });
  }
});

// GET /api/v1/rides/:id — ce que le passager voit avant embarquement// NOTE MVP : l'expiration d'une offre pilote non honorée est gérée ici, "à la demande"
// (quand quelqu'un consulte la course), pas par un vrai job d'arrière-plan planifié.
// En production, un job périodique (ex. toutes les 5 secondes) serait plus robuste et
// réactif, indépendamment du fait que quelqu'un consulte la course ou non.
router.get('/:id', requireAuth, async (req, res) => {
  const current = await pool.query(
    `SELECT status, candidate_driver_id, offer_expires_at, declined_driver_ids
     FROM rides WHERE id = $1`,
    [req.params.id]
  );
  if (!current.rows[0]) return res.status(404).json({ error: 'Course introuvable' });

  const c = current.rows[0];
  if (c.status === 'REQUESTED' && c.candidate_driver_id && new Date(c.offer_expires_at) < new Date()) {
    const declined = [...(c.declined_driver_ids || []), c.candidate_driver_id];
    await pool.query(
      `UPDATE rides SET declined_driver_ids = $2, candidate_driver_id = NULL, offer_expires_at = NULL WHERE id = $1`,
      [req.params.id, declined]
    );
    await attemptMatch({ id: req.params.id });
  }

  const result = await pool.query(
    `SELECT id, passenger_id, driver_id, status, service_tier,
            distance_km, duration_min, estimate_price, meter_final_price, final_price,
            payment_method, vehicle_check_confirmed, requested_at, started_at, completed_at
     FROM rides WHERE id = $1`,
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
            v.plate_number, v.color, v.photo_url AS vehicle_photo_url, v.make, v.model
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
  const { status, driver_id, vehicle_id } = req.body;
  const allowed = ['MATCHED', 'ONGOING', 'COMPLETED', 'CANCELLED'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'status invalide' });

  const fields = ['status = $2'];
  const values = [req.params.id, status];
  let idx = 3;

  if (status === 'MATCHED' && driver_id) {
    fields.push(`driver_id = $${idx++}`); values.push(driver_id);
    if (vehicle_id) { fields.push(`vehicle_id = $${idx++}`); values.push(vehicle_id); }
  }
  if (status === 'ONGOING') fields.push('started_at = now()');
  if (status === 'CANCELLED') fields.push('cancelled_at = now()');

  const result = await pool.query(
    `UPDATE rides SET ${fields.join(', ')} WHERE id = $1 RETURNING id, status`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Course introuvable' });
  res.json(result.rows[0]);
});

// POST /api/v1/rides/:id/offer/accept — le pilote accepte la course qui lui a été proposée
router.post('/:id/offer/accept', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rideResult = await client.query(
      `SELECT id, candidate_driver_id, offer_expires_at, vehicle_id FROM rides WHERE id = $1 FOR UPDATE`,
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
    `SELECT r.id, r.fare_rule_id, fr.base_fee, fr.included_km, fr.city_radius_km,
            fr.cost_per_km_city, fr.cost_per_km_suburb, fr.cost_per_min, fr.minimum_fare
     FROM rides r JOIN fare_rules fr ON fr.id = r.fare_rule_id
     WHERE r.id = $1`,
    [req.params.id]
  );
  const ride = rideResult.rows[0];
  if (!ride) return res.status(404).json({ error: 'Course introuvable' });

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

      const conditions = {
        isWeekend: isWeekendDate(new Date()),
        isRaining: !!ride.rain_flag,
        isHeavyTraffic: isHeavyTrafficCondition(actualDurationMin, Number(ride.duration_min)),
      };
      const appliedCommissionRate = computeCommissionRate(ride.commission_rate, conditions);
      const commission = Math.round(ridePriceForDriver * appliedCommissionRate);

      const walletResult = await client.query('SELECT id, balance, negative_floor FROM wallets WHERE user_id = $1 FOR UPDATE', [ride.driver_id]);
      const wallet = walletResult.rows[0];
      if (wallet) {
        const newBalance = Number(wallet.balance) - commission;
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
      }
    }

    await client.query('COMMIT');

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
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur lors de la clôture de la course' });
  } finally {
    client.release();
  }
});

// POST /api/v1/rides/:id/sos
router.post('/:id/sos', requireAuth, async (req, res) => {
  const { lat, lng, reason = 'MANUAL' } = req.body;
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
