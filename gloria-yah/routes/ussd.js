// Accès GLORI-YAH par USSD (*XXX#) — pour les téléphones basiques sans internet.
//
// ⚠️ SQUELETTE TECHNIQUE, PAS ENCORE FONCTIONNEL EN CONDITIONS RÉELLES : ça
// suppose un code court USSD obtenu auprès d'un opérateur télécom (MTN, Moov,
// Celtiis...) et une passerelle USSD payante (ex. Africa's Talking, qui propose
// ce service séparément de leur API SMS) qui redirigera les requêtes vers cette
// route. Tant que ça n'est pas configuré, ce code n'est testable qu'en appelant
// directement POST /api/v1/ussd à la main (curl/Postman), jamais depuis un vrai
// téléphone.
//
// Format attendu par la plupart des passerelles USSD (dont Africa's Talking) :
// - Entrée : sessionId, phoneNumber, text (le chemin de menu choisi, séparé par *)
// - Sortie : texte brut commençant par "CON " (continuer, afficher un autre écran)
//   ou "END " (terminer la session, dernier message affiché)

const express = require('express');
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { haversineKm, estimateDurationMin, computeFare } = require('../services/pricing');
const { attemptMatch } = require('../services/matching');

const router = express.Router();

// Quartiers connus proposés dans le menu USSD (pas de recherche libre possible
// en USSD — l'écran est trop limité pour taper une adresse complète).
const USSD_DESTINATIONS = [
  { label: 'Akpakpa', lat: 6.3664, lng: 2.4558 },
  { label: 'Cadjèhoun', lat: 6.3617, lng: 2.3800 },
  { label: 'Dantokpa', lat: 6.3707, lng: 2.4256 },
  { label: 'Calavi', lat: 6.4485, lng: 2.3389 },
  { label: 'Godomey', lat: 6.4015, lng: 2.3273 },
];

async function findOrCreateUssdUser(phoneNumber) {
  const existing = await pool.query('SELECT id FROM users WHERE phone_number = $1', [phoneNumber]);
  if (existing.rows[0]) return existing.rows[0].id;

  // Compte créé automatiquement au premier usage USSD, comme pour l'inscription
  // par OTP — pas de mot de passe utilisable, juste pour permettre la réservation.
  const randomLock = require('crypto').randomBytes(32).toString('hex');
  const unusableHash = await bcrypt.hash(randomLock, 10);
  const result = await pool.query(
    `INSERT INTO users (phone_number, full_name, password_hash, role, country_id)
     VALUES ($1, 'Passager USSD', $2, 'PASSAGER', 'BJ')
     RETURNING id`,
    [phoneNumber, unusableHash]
  );
  return result.rows[0].id;
}

// POST /api/v1/ussd
router.post('/', async (req, res) => {
  const { phoneNumber, text } = req.body;
  const steps = (text || '').split('*').filter(Boolean);

  res.set('Content-Type', 'text/plain');

  try {
    // Écran principal
    if (steps.length === 0) {
      return res.send(
        'CON Bienvenue sur GLORI-YAH\n' +
        '1. Réserver une course\n' +
        '2. Mon parrainage\n' +
        '3. Aide'
      );
    }

    // 1. Réserver une course -> choisir une destination
    if (steps[0] === '1' && steps.length === 1) {
      const menu = USSD_DESTINATIONS.map((d, i) => `${i + 1}. ${d.label}`).join('\n');
      return res.send(`CON Où allez-vous ?\n${menu}`);
    }

    // 1*X -> destination choisie, afficher l'estimation et demander confirmation
    if (steps[0] === '1' && steps.length === 2) {
      const idx = parseInt(steps[1], 10) - 1;
      const dest = USSD_DESTINATIONS[idx];
      if (!dest) return res.send('END Choix invalide. Recommencez avec *XXX#.');

      // NOTE MVP : le point de départ est supposé être Cotonou centre (pas de
      // vraie géolocalisation possible en USSD sans matériel supplémentaire) —
      // à améliorer plus tard, par ex. en demandant le quartier de départ aussi.
      const pickup = { lat: 6.3703, lng: 2.3912 };
      const distanceKm = haversineKm(pickup.lat, pickup.lng, dest.lat, dest.lng);
      const durationMin = estimateDurationMin(distanceKm);

      const fareRule = await pool.query(
        `SELECT * FROM fare_rules WHERE country_id = 'BJ' AND service_tier = 'ESSENTIEL' AND active = true LIMIT 1`
      );
      if (!fareRule.rows[0]) return res.send('END Service indisponible pour le moment.');

      const price = computeFare(fareRule.rows[0], distanceKm, durationMin);
      return res.send(
        `CON Trajet vers ${dest.label}\n` +
        `Prix estimé : ${Math.round(price)} FCFA\n` +
        `Distance : ${distanceKm.toFixed(1)} km\n` +
        `1. Confirmer\n2. Annuler`
      );
    }

    // 1*X*1 -> confirmation, création réelle de la course
    if (steps[0] === '1' && steps.length === 3) {
      if (steps[2] !== '1') return res.send('END Course annulée.');

      const idx = parseInt(steps[1], 10) - 1;
      const dest = USSD_DESTINATIONS[idx];
      if (!dest) return res.send('END Choix invalide.');

      const userId = await findOrCreateUssdUser(phoneNumber);
      const pickup = { lat: 6.3703, lng: 2.3912 };
      const distanceKm = haversineKm(pickup.lat, pickup.lng, dest.lat, dest.lng);
      const durationMin = estimateDurationMin(distanceKm);

      const fareRule = await pool.query(
        `SELECT * FROM fare_rules WHERE country_id = 'BJ' AND service_tier = 'ESSENTIEL' AND active = true LIMIT 1`
      );
      const price = computeFare(fareRule.rows[0], distanceKm, durationMin);

      const insertResult = await pool.query(
        `INSERT INTO rides (passenger_id, fare_rule_id, country_id, currency_code, service_tier,
           pickup_point, destination_point, status, distance_km, duration_min, estimate_price, payment_method)
         VALUES ($1, $2, 'BJ', 'XOF', 'ESSENTIEL',
           ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
           ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography,
           'REQUESTED', $7, $8, $9, 'CASH')
         RETURNING id`,
        [userId, fareRule.rows[0].id, pickup.lng, pickup.lat, dest.lng, dest.lat, distanceKm, durationMin, Math.round(price)]
      );

      // CORRECTIF (audit 31/08/2026) : la recherche de pilote n'était jamais
      // déclenchée ici — la course restait indéfiniment sans être proposée à
      // personne. Alignée maintenant sur POST /rides classique.
      await attemptMatch(insertResult.rows[0]);

      return res.send(`END Course commandée vers ${dest.label} ! Un pilote va bientôt être recherché. Prix estimé : ${Math.round(price)} FCFA.`);
    }

    // 2. Mon parrainage
    if (steps[0] === '2') {
      const user = await pool.query('SELECT id, referral_code, free_ride_credit_fcfa FROM users WHERE phone_number = $1', [phoneNumber]);
      if (!user.rows[0]) return res.send('END Aucun compte trouvé avec ce numéro. Réservez une course pour en créer un.');

      const u = user.rows[0];
      return res.send(
        `END Ton code de parrainage : ${u.referral_code}\n` +
        `Crédit course gratuite : ${u.free_ride_credit_fcfa} FCFA`
      );
    }

    // 3. Aide
    if (steps[0] === '3') {
      return res.send('END GLORI-YAH — Assistance : contactez le support depuis l\'application ou au numéro affiché sur nos affiches.');
    }

    return res.send('END Choix invalide. Recommencez avec *XXX#.');
  } catch (err) {
    console.error('Erreur USSD :', err.message);
    return res.send('END Une erreur est survenue. Réessayez plus tard.');
  }
});

module.exports = router;
