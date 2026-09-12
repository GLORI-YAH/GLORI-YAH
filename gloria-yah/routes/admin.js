const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/v1/admin/overview — KPIs simples pour le dashboard
router.get('/overview', async (req, res) => {
  const [rides, wallets, kyc, sos, users, credit, onboarding, countries, vehiclesPending] = await Promise.all([
    pool.query(`SELECT status, COUNT(*) FROM rides WHERE requested_at > now() - interval '1 day' GROUP BY status`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE balance < 0) AS negative_wallets FROM wallets`),
    pool.query(`SELECT COUNT(*) AS pending_kyc FROM kyc_documents WHERE status = 'PENDING'`),
    pool.query(`SELECT COUNT(*) AS open_sos FROM sos_alerts WHERE status = 'OPEN'`),
    // Utilisateurs actifs par rôle (compte total, pas juste "en ligne maintenant")
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE role = 'PASSAGER') AS total_passengers,
         COUNT(*) FILTER (WHERE role = 'CHAUFFEUR') AS total_drivers,
         COUNT(*) FILTER (WHERE role = 'CHAUFFEUR' AND is_online = true) AS drivers_online_now
       FROM users`
    ),
    // Crédit fidélité/parrainage actuellement en circulation (solde courant
    // cumulé sur tous les passagers) — c'est un engagement financier de la
    // plateforme (remises "dues"), pas le total historiquement distribué
    // (les utilisations passées font déjà baisser ce solde).
    pool.query(`SELECT COALESCE(SUM(free_ride_credit_fcfa), 0) AS credit_outstanding_fcfa FROM users WHERE role = 'PASSAGER'`),
    // Onboarding en attente : pilotes inscrits qui n'ont encore jamais pris de
    // course (jamais passés en ligne avec succès, ou en ligne mais sans
    // aucune course terminée) — utile pour relancer/accompagner les nouveaux.
    pool.query(
      `SELECT COUNT(*) AS pending_driver_onboarding
       FROM users u
       WHERE u.role = 'CHAUFFEUR'
         AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.driver_id = u.id AND r.status = 'COMPLETED')`
    ),
    pool.query(`SELECT COUNT(DISTINCT country_id) AS countries_active FROM fare_rules WHERE active = true`),
    pool.query(`SELECT COUNT(*) AS vehicles_pending FROM vehicles WHERE kyc_status = 'PENDING' OR photo_verified = false`),
  ]);
  res.json({
    rides_last_24h_by_status: rides.rows,
    negative_wallets: Number(wallets.rows[0].negative_wallets),
    pending_kyc: Number(kyc.rows[0].pending_kyc),
    open_sos: Number(sos.rows[0].open_sos),
    total_passengers: Number(users.rows[0].total_passengers),
    total_drivers: Number(users.rows[0].total_drivers),
    drivers_online_now: Number(users.rows[0].drivers_online_now),
    credit_outstanding_fcfa: Number(credit.rows[0].credit_outstanding_fcfa),
    pending_driver_onboarding: Number(onboarding.rows[0].pending_driver_onboarding),
    countries_active: Number(countries.rows[0].countries_active),
    vehicles_pending: Number(vehiclesPending.rows[0].vehicles_pending),
  });
});

// GET /api/v1/admin/vehicles/pending — véhicules en attente de vérification photo/KYC
router.get('/vehicles/pending', async (req, res) => {
  const result = await pool.query(
    `SELECT id, plate_number, color, photo_url, photo_verified, kyc_status, created_at
     FROM vehicles WHERE kyc_status = 'PENDING' OR photo_verified = false
     ORDER BY created_at ASC LIMIT 50`
  );
  res.json(result.rows);
});

// PATCH /api/v1/admin/vehicles/:id/verify-photo — validation manuelle admin (plaque/couleur/photo cohérentes)
router.patch('/vehicles/:id/verify-photo', async (req, res) => {
  const result = await pool.query(
    `UPDATE vehicles SET photo_verified = true WHERE id = $1 RETURNING id, photo_verified`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Véhicule introuvable' });
  res.json(result.rows[0]);
});

// PATCH /api/v1/admin/vehicles/:id/service-tier — assigne/corrige la gamme d'un
// véhicule (audit 31/08/2026 : nécessaire pour les véhicules déjà en base avant
// l'ajout de cette colonne, qui ont service_tier = NULL et ne peuvent recevoir
// aucune course tant qu'un admin ne leur assigne pas une gamme explicitement).
router.patch('/vehicles/:id/service-tier', async (req, res) => {
  const { service_tier } = req.body;
  const valid = ['MOTO', 'ESSENTIEL', 'SIGNATURE', 'PRESTIGE', 'KLOBOTO'];
  if (!valid.includes(service_tier)) {
    return res.status(400).json({ error: `service_tier doit être l'un de : ${valid.join(', ')}` });
  }
  const result = await pool.query(
    `UPDATE vehicles SET service_tier = $2 WHERE id = $1 RETURNING id, plate_number, service_tier`,
    [req.params.id, service_tier]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Véhicule introuvable' });
  res.json(result.rows[0]);
});

// GET /api/v1/admin/drivers/suspicious-cancellations — pilotes signalés pour
// avoir demandé au passager d'annuler et payer hors plateforme (protection
// anti-fraude, voir migration 023). Inclut les pilotes déjà bloqués
// automatiquement (3+ signalements) ET ceux qui approchent du seuil.
router.get('/drivers/suspicious-cancellations', async (req, res) => {
  const result = await pool.query(
    `SELECT u.id AS driver_id, u.full_name, u.phone_number, u.is_online,
            COUNT(r.id) AS nb_signalements,
            MAX(r.cancelled_at) AS dernier_signalement
     FROM rides r
     JOIN users u ON u.id = r.driver_id
     WHERE r.cancellation_reason = 'CHAUFFEUR_DEMANDE_ANNULATION'
       AND r.cancelled_at > COALESCE(u.fraud_flags_cleared_at, '1970-01-01')
     GROUP BY u.id, u.full_name, u.phone_number, u.is_online
     HAVING COUNT(r.id) >= 1
     ORDER BY COUNT(r.id) DESC`
  );
  res.json(result.rows);
});

// PATCH /api/v1/admin/drivers/:id/clear-fraud-flags — après revue humaine,
// "blanchit" le pilote (les signalements passés ne comptent plus, mais restent
// dans l'historique) — débloque aussi son compte si le blocage automatique
// avait été déclenché.
router.patch('/drivers/:id/clear-fraud-flags', async (req, res) => {
  await pool.query('UPDATE users SET fraud_flags_cleared_at = now() WHERE id = $1', [req.params.id]);
  const walletResult = await pool.query('SELECT id FROM wallets WHERE user_id = $1', [req.params.id]);
  if (walletResult.rows[0]) {
    await pool.query('UPDATE wallets SET is_blocked = false WHERE id = $1', [walletResult.rows[0].id]);
  }
  res.json({ cleared: true });
});

// GET /api/v1/admin/pricing-zones — liste des zones de tarification géographique
router.get('/pricing-zones', async (req, res) => {
  const result = await pool.query('SELECT * FROM pricing_zones ORDER BY created_at DESC');
  res.json(result.rows);
});

// POST /api/v1/admin/pricing-zones — crée une zone (ex. "Aéroport de Cotonou")
router.post('/pricing-zones', async (req, res) => {
  const { name, country_id, center_lat, center_lng, radius_km, zone_commission_rate } = req.body;
  if (!name || !country_id || center_lat == null || center_lng == null || !radius_km || zone_commission_rate == null) {
    return res.status(400).json({ error: 'name, country_id, center_lat, center_lng, radius_km et zone_commission_rate sont requis' });
  }
  if (zone_commission_rate < 0 || zone_commission_rate > 1) {
    return res.status(400).json({ error: 'zone_commission_rate doit être entre 0 et 1' });
  }
  const result = await pool.query(
    `INSERT INTO pricing_zones (name, country_id, center_lat, center_lng, radius_km, zone_commission_rate)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, country_id, center_lat, center_lng, radius_km, zone_commission_rate]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /api/v1/admin/pricing-zones/:id — active/désactive ou ajuste une zone
router.patch('/pricing-zones/:id', async (req, res) => {
  const allowedFields = ['name', 'radius_km', 'zone_commission_rate', 'active'];
  const fields = [];
  const values = [req.params.id];
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      values.push(req.body[key]);
      fields.push(`${key} = $${values.length}`);
    }
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier fourni' });
  const result = await pool.query(`UPDATE pricing_zones SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, values);
  if (!result.rows[0]) return res.status(404).json({ error: 'Zone introuvable' });
  res.json(result.rows[0]);
});

// DELETE /api/v1/admin/pricing-zones/:id
router.delete('/pricing-zones/:id', async (req, res) => {
  await pool.query('DELETE FROM pricing_zones WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

// GET /api/v1/admin/fleet — positions de tous les pilotes en ligne, pour la
// carte "flotte en direct" (vert = disponible, rouge = en course).
router.get('/fleet', async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.full_name,
            ST_Y(u.current_position::geometry) AS lat, ST_X(u.current_position::geometry) AS lng,
            EXISTS(SELECT 1 FROM rides r WHERE r.driver_id = u.id AND r.status IN ('MATCHED', 'ONGOING')) AS en_course
     FROM users u
     WHERE u.role = 'CHAUFFEUR' AND u.is_online = true AND u.current_position IS NOT NULL`
  );
  res.json(result.rows);
});

// GET /api/v1/admin/drivers/search?q=... — recherche un pilote par nom/téléphone
// (nécessaire pour lui appliquer une commission personnalisée)
router.get('/drivers/search', async (req, res) => {
  const q = '%' + (req.query.q || '') + '%';
  const result = await pool.query(
    `SELECT id, full_name, phone_number, commission_override, country_id
     FROM users WHERE role = 'CHAUFFEUR' AND (full_name ILIKE $1 OR phone_number ILIKE $1)
     ORDER BY full_name ASC LIMIT 20`,
    [q]
  );
  res.json(result.rows);
});

// PATCH /api/v1/admin/drivers/:id/commission-override — rend un pilote gratuit
// (0) ou lui applique un taux personnalisé, à la guise de l'admin (promotion,
// partenariat...). Passer null pour revenir au taux normal de la grille tarifaire.
router.patch('/drivers/:id/commission-override', async (req, res) => {
  const { rate } = req.body; // nombre entre 0 et 1, ou null pour réinitialiser
  if (rate !== null && (typeof rate !== 'number' || rate < 0 || rate > 1)) {
    return res.status(400).json({ error: 'rate doit être un nombre entre 0 et 1, ou null pour réinitialiser' });
  }
  const result = await pool.query(
    'UPDATE users SET commission_override = $2 WHERE id = $1 AND role = \'CHAUFFEUR\' RETURNING id, full_name, commission_override',
    [req.params.id, rate]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Pilote introuvable' });
  res.json(result.rows[0]);
});

// GET /api/v1/admin/fare-rules — toutes les grilles tarifaires, pour les
// modifier directement depuis l'admin sans passer par une migration SQL.
router.get('/fare-rules', async (req, res) => {
  const result = await pool.query(
    `SELECT id, country_id, service_tier, base_fee, city_radius_km, cost_per_km_city,
            cost_per_km_suburb, cost_per_min, minimum_fare, commission_rate, included_km
     FROM fare_rules ORDER BY country_id, service_tier`
  );
  res.json(result.rows);
});

// PATCH /api/v1/admin/fare-rules/:id — modifie une grille tarifaire existante.
// Seuls les champs envoyés sont modifiés (mise à jour partielle).
router.patch('/fare-rules/:id', async (req, res) => {
  const allowedFields = ['base_fee', 'city_radius_km', 'cost_per_km_city', 'cost_per_km_suburb', 'cost_per_min', 'minimum_fare', 'commission_rate', 'included_km'];
  const fields = [];
  const values = [req.params.id];
  for (const key of allowedFields) {
    if (req.body[key] !== undefined) {
      values.push(req.body[key]);
      fields.push(`${key} = $${values.length}`);
    }
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier fourni' });

  const result = await pool.query(
    `UPDATE fare_rules SET ${fields.join(', ')} WHERE id = $1 RETURNING *`,
    values
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Grille tarifaire introuvable' });
  res.json(result.rows[0]);
});

// GET /api/v1/admin/vehicles/no-tier — véhicules sans gamme assignée (ne
// peuvent recevoir AUCUNE course tant que ce n'est pas corrigé)
router.get('/vehicles/no-tier', async (req, res) => {
  const result = await pool.query(
    `SELECT id, plate_number, color, make, model, owner_id FROM vehicles WHERE service_tier IS NULL ORDER BY created_at ASC LIMIT 100`
  );
  res.json(result.rows);
});

// GET /api/v1/admin/kyc/pending — documents pilote en attente de vérification (permis, selfie)
router.get('/kyc/pending', async (req, res) => {
  const result = await pool.query(
    `SELECT k.id, k.doc_type, k.file_url, k.created_at,
            u.full_name AS driver_name, u.phone_number AS driver_phone
     FROM kyc_documents k
     JOIN users u ON u.id = k.user_id
     WHERE k.status = 'PENDING'
     ORDER BY k.created_at ASC LIMIT 50`
  );
  res.json(result.rows);
});

// PATCH /api/v1/admin/kyc/:id/review — approuve ou rejette un document
router.patch('/kyc/:id/review', async (req, res) => {
  const { approved } = req.body;
  if (typeof approved !== 'boolean') return res.status(400).json({ error: 'approved (true/false) est requis' });

  const result = await pool.query(
    `UPDATE kyc_documents SET status = $2, reviewed_by = $3, reviewed_at = now()
     WHERE id = $1 RETURNING id, user_id, doc_type, status, file_url`,
    [req.params.id, approved ? 'VERIFIED' : 'REJECTED', req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Document introuvable' });

  // Le selfie vérifié devient la photo de profil publique du pilote — c'est la
  // seule photo du pilote qu'on peut garantir récente et confirmée par un humain,
  // donc la plus digne de confiance à montrer au passager.
  const doc = result.rows[0];
  if (approved && doc.doc_type === 'SELFIE') {
    await pool.query('UPDATE users SET driver_photo_url = $2 WHERE id = $1', [doc.user_id, doc.file_url]);
  }

  res.json({ id: doc.id, doc_type: doc.doc_type, status: doc.status });
});

// GET /api/v1/admin/sos/open — avec infos utiles pour agir (qui, quel numéro appeler, quelle course)
router.get('/sos/open', async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.ride_id, s.triggered_by, s.reason, s.status, s.created_at,
            ST_Y(s.position::geometry) AS lat, ST_X(s.position::geometry) AS lng,
            u.full_name AS triggered_by_name, u.phone_number AS triggered_by_phone
     FROM sos_alerts s
     LEFT JOIN users u ON u.id = s.triggered_by
     WHERE s.status = 'OPEN' ORDER BY s.created_at ASC`
  );
  res.json(result.rows);
});

// PATCH /api/v1/admin/sos/:id/resolve — l'admin confirme avoir traité l'alerte
router.patch('/sos/:id/resolve', async (req, res) => {
  const result = await pool.query(
    `UPDATE sos_alerts SET status = 'RESOLVED', handled_by = $2, resolved_at = now()
     WHERE id = $1 AND status = 'OPEN' RETURNING id, status`,
    [req.params.id, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Alerte introuvable ou déjà traitée' });
  res.json(result.rows[0]);
});

module.exports = router;
