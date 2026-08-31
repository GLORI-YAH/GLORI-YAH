const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('ADMIN'));

// GET /api/v1/admin/overview — KPIs simples pour le dashboard
router.get('/overview', async (req, res) => {
  const [rides, wallets, kyc, sos] = await Promise.all([
    pool.query(`SELECT status, COUNT(*) FROM rides WHERE requested_at > now() - interval '1 day' GROUP BY status`),
    pool.query(`SELECT COUNT(*) FILTER (WHERE balance < 0) AS negative_wallets FROM wallets`),
    pool.query(`SELECT COUNT(*) AS pending_kyc FROM kyc_documents WHERE status = 'PENDING'`),
    pool.query(`SELECT COUNT(*) AS open_sos FROM sos_alerts WHERE status = 'OPEN'`),
  ]);
  res.json({
    rides_last_24h_by_status: rides.rows,
    negative_wallets: Number(wallets.rows[0].negative_wallets),
    pending_kyc: Number(kyc.rows[0].pending_kyc),
    open_sos: Number(sos.rows[0].open_sos),
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

// GET /api/v1/admin/sos/open
router.get('/sos/open', async (req, res) => {
  const result = await pool.query(
    `SELECT id, ride_id, triggered_by, reason, status, created_at,
            ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng
     FROM sos_alerts WHERE status = 'OPEN' ORDER BY created_at ASC`
  );
  res.json(result.rows);
});

module.exports = router;
