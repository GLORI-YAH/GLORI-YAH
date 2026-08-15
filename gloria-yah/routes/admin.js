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
