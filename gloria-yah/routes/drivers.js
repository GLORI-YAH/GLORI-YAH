const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/v1/drivers/online — le pilote se déclare disponible ou non
router.post('/online', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const { online } = req.body;
  await pool.query('UPDATE users SET is_online = $2 WHERE id = $1', [req.user.id, !!online]);
  res.json({ is_online: !!online });
});

// POST /api/v1/drivers/location — le pilote pousse sa position en direct
// (à appeler périodiquement depuis l'app pilote, ex. toutes les 10-15 secondes)
router.post('/location', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const { lat, lng } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat et lng sont requis' });

  await pool.query(
    `UPDATE users SET current_position = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                       location_updated_at = now()
     WHERE id = $1`,
    [req.user.id, lng, lat]
  );
  res.json({ updated: true });
});

// GET /api/v1/drivers/pending-offer — le pilote vérifie s'il a une course à lui proposer
// MVP : basé sur l'interrogation périodique (polling) par l'app pilote toutes les
// quelques secondes. Une vraie notification push serait plus efficace en production
// (moins de latence, moins de charge serveur) — à prévoir dans une itération future.
router.get('/pending-offer', requireAuth, requireRole('CHAUFFEUR'), async (req, res) => {
  const result = await pool.query(
    `SELECT id, estimate_price, distance_km, duration_min, offer_expires_at,
            ST_Y(destination_point::geometry) AS dest_lat, ST_X(destination_point::geometry) AS dest_lng
     FROM rides
     WHERE candidate_driver_id = $1 AND status = 'REQUESTED' AND offer_expires_at > now()
     ORDER BY requested_at ASC LIMIT 1`,
    [req.user.id]
  );

  if (!result.rows[0]) return res.json({ offer: null });
  res.json({ offer: result.rows[0] });
});

module.exports = router;
